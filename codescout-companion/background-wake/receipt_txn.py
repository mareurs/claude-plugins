"""One private, OS-locked receipt transaction; never sends to a harness."""
import argparse
import csv
import ctypes
import hashlib
import io
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
import sys
import time


def windows_private(path):
    """Apply a complete protected DACL, not a grant layered over unknown ACEs."""
    from ctypes import wintypes
    system = Path(os.environ.get('SystemRoot', r'C:\Windows')) / 'System32'
    if str(path).startswith('\\\\'):
        raise OSError('network paths are unsupported')
    sid_rows = list(csv.reader(subprocess.check_output([str(system / 'whoami.exe'), '/user', '/fo', 'csv', '/nh'], text=True).strip().splitlines()))
    sid = sid_rows[-1][-1]
    if not re.fullmatch(r'S-[0-9-]+', sid):
        raise OSError('cannot establish native user identity')
    adv = ctypes.WinDLL('advapi32', use_last_error=True)
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    ptr = ctypes.c_void_p
    adv.ConvertStringSecurityDescriptorToSecurityDescriptorW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, ctypes.POINTER(ptr), ctypes.POINTER(wintypes.DWORD)]
    adv.ConvertStringSecurityDescriptorToSecurityDescriptorW.restype = wintypes.BOOL
    adv.GetSecurityDescriptorDacl.argtypes = [ptr, ctypes.POINTER(wintypes.BOOL), ctypes.POINTER(ptr), ctypes.POINTER(wintypes.BOOL)]
    adv.GetSecurityDescriptorDacl.restype = wintypes.BOOL
    adv.SetNamedSecurityInfoW.argtypes = [wintypes.LPWSTR, wintypes.DWORD, wintypes.DWORD, ptr, ptr, ptr, ptr]
    adv.SetNamedSecurityInfoW.restype = wintypes.DWORD
    kernel.LocalFree.argtypes = [ptr]
    kernel.LocalFree.restype = ptr
    sd, dacl = ptr(), ptr()
    present, defaulted = wintypes.BOOL(), wintypes.BOOL()
    sddl = f'D:P(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)(A;OICI;FA;;;{sid})'
    if not adv.ConvertStringSecurityDescriptorToSecurityDescriptorW(sddl, 1, ctypes.byref(sd), None):
        raise ctypes.WinError(ctypes.get_last_error())
    try:
        if not adv.GetSecurityDescriptorDacl(sd, ctypes.byref(present), ctypes.byref(dacl), ctypes.byref(defaulted)) or not present:
            raise OSError('private DACL unavailable')
        code = adv.SetNamedSecurityInfoW(str(path), 1, 0x80000004, None, None, dacl, None)
        if code:
            raise ctypes.WinError(code)
    finally:
        kernel.LocalFree(sd)


def private_root(path):
    if not path.is_absolute() or path.is_symlink():
        raise OSError('private state root must be absolute and not a link')
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    if os.name == 'nt':
        windows_private(path)
    else:
        if path.stat().st_uid != os.getuid():
            raise OSError('private state root has another owner')
        os.chmod(path, 0o700)
        if path.stat().st_mode & 0o077:
            raise OSError('private state permissions unavailable')
    return path


def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, separators=(',', ':')).encode('utf-8')).hexdigest()


def validate_event(event, key):
    job, target = event['job'], event['target']
    job_key = digest(['job-v1'] + [job[k] for k in ('recordPath', 'schema', 'serverPid', 'serverToken', 'handle')])
    target_key = digest(['binding-v1'] + [target[k] for k in ('harness', 'profileRoot', 'hostInstanceId', 'environmentId', 'sessionId', 'runtimeGeneration', 'origin')])
    expected = 'wake1:' + digest(['event-v1', job_key, target_key, event['kind'], event['sequence']])
    if event.get('version') != 1 or event.get('eventId') != key or expected != key or job['schema'] != 1 or target['origin'] != 'root':
        raise ValueError('invalid event identity')
    if event['kind'] not in ('terminal', 'heartbeat', 'tracking-lost'):
        raise ValueError('unsupported event kind')


def locked(file):
    """Persistent inode/byte lock; callers never delete this file."""
    until = time.monotonic() + 2
    while True:
        try:
            file.seek(0)
            if os.name == 'nt':
                import msvcrt
                msvcrt.locking(file.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            return
        except OSError:
            if time.monotonic() >= until:
                raise TimeoutError('receipt lock busy')
            time.sleep(0.01)


def publish(path, record):
    tmp = path.with_name(path.name + '.tmp-' + secrets.token_hex(12))
    try:
        with open(tmp, 'x', encoding='utf-8') as stream:
            if os.name != 'nt':
                os.fchmod(stream.fileno(), 0o600)
            json.dump(record, stream, ensure_ascii=False, separators=(',', ':'))
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(tmp, path)
        if os.name != 'nt':
            fd = os.open(path.parent, os.O_RDONLY)
            try:
                os.fsync(fd)
            finally:
                os.close(fd)
    finally:
        try:
            tmp.unlink()
        except FileNotFoundError:
            pass


def owns(record, command, live=False):
    return (record.get('ownerToken') == command.get('ownerToken')
            and record.get('attemptId') == command.get('attemptId')
            and (not live or record.get('leaseUntilMs', 0) > command['nowMs']))


def apply_command(record, command):
    op, now = command['op'], command['nowMs']
    fail = lambda reason: (False, record, reason)
    if not isinstance(now, int) or isinstance(now, bool) or now < 0:
        return fail('invalid transaction clock')
    if record is None:
        if op != 'ensure':
            return fail('receipt missing')
        validate_event(command['event'], command['eventId'])
        return True, {'version': 1, 'event': command['event'], 'state': 'pending', 'updatedAtMs': now}, 'event persisted'
    if record.get('version') != 1 or record['event']['eventId'] != command['eventId']:
        return fail('unsupported receipt identity')
    if op == 'ensure':
        validate_event(command['event'], command['eventId'])
        return True, record, 'event already registered'
    if now < record['updatedAtMs']:
        return fail('transaction clock moved backward')
    if op == 'claim':
        if record['state'] not in ('pending', 'failed') or (record['state'] == 'failed' and not record.get('lastError', {}).get('safeRetry')):
            return fail('event cannot be claimed')
        token = command.get('ownerToken', '')
        lease = command.get('leaseMs', 0)
        if not re.fullmatch(r'[a-f0-9-]{32,64}', token) or not command.get('attemptId') or not isinstance(lease, int) or lease <= 0:
            return fail('valid fresh owner, attempt and lease required')
        record.update(state='claimed', ownerToken=token, attemptId=command['attemptId'], leaseUntilMs=now + lease)
    elif op == 'renew':
        if record['state'] != 'claimed' or not owns(record, command, live=True) or command.get('leaseMs', 0) <= 0:
            return fail('lease is not owned and live')
        record['leaseUntilMs'] = now + command['leaseMs']
    elif op == 'begin-send':
        if record['state'] != 'claimed' or not owns(record, command, live=True):
            return fail('no live send lease')
        record.update(state='sending', sendIntentAtMs=now)
    elif op == 'release':
        if not owns(record, command):
            return fail('lease belongs to another attempt')
        record.pop('ownerToken', None)
        record.pop('leaseUntilMs', None)
        if record['state'] == 'claimed':
            record['state'] = 'pending'
    elif op == 'recover':
        if record.get('leaseUntilMs', now + 1) > now:
            return fail('lease has not expired')
        if record['state'] == 'claimed' and 'sendIntentAtMs' not in record:
            record['state'] = 'pending'
            record.pop('ownerToken', None)
            record.pop('leaseUntilMs', None)
        elif record['state'] == 'sending':
            record['state'] = 'unknown'
        else:
            return fail('only pre-send claims are retryable; sending recovery is unknown')
    elif op == 'evidence':
        if record.get('attemptId') != command.get('attemptId'):
            return fail('evidence belongs to another attempt')
        evidence, result = command.get('evidence'), command.get('result')
        if evidence:
            ranks = {'accepted': 1, 'continuation_observed': 2, 'completed': 3}
            state = evidence.get('state')
            if evidence.get('eventId') != command['eventId'] or evidence.get('attemptId') != command['attemptId'] or state not in ranks or not evidence.get('correlation'):
                return fail('evidence is not correlated')
            if record['state'] not in ('sending', 'unknown', 'accepted', 'continuation_observed', 'completed'):
                return fail('evidence has no prior send intent')
            if ranks[state] >= ranks.get(record['state'], 0):
                record['state'] = state
                record['lastEvidence'] = evidence
        elif result and record['state'] == 'sending':
            kind = result.get('kind')
            if kind == 'pre-send-failure':
                record.update(state='failed', lastError={'kind': kind, 'safeRetry': True, 'reason': str(result.get('reason', ''))[:240]})
                record.pop('sendIntentAtMs', None)
            elif kind == 'emitted-unconfirmed':
                record['lastEvidence'] = {'kind': kind, 'attemptId': command['attemptId']}
            elif kind == 'unknown':
                record.update(state='unknown', lastError={'kind': kind, 'safeRetry': False, 'reason': str(result.get('reason', ''))[:240]})
            elif kind != 'finished':
                return fail('unsupported delivery result')
        else:
            return fail('missing or inapplicable delivery evidence')
    elif op == 'gc':
        return True, record, 'retained stable deduplication identity; unresolved receipts are never erased'
    else:
        return fail('unsupported transaction operation')
    record['updatedAtMs'] = now
    return True, record, 'transaction committed'


def transact(root, command):
    if command.get('op') == 'probe':
        return {'ok': True, 'receipt': None, 'root': str(root), 'reason': 'private native storage available'}
    key = command.get('eventId', '')
    if not re.fullmatch(r'wake1:[a-f0-9]{64}', key):
        raise ValueError('invalid event key')
    stem = key[6:]
    path, lock_path = root / (stem + '.json'), root / (stem + '.lock')
    if path.is_symlink() or lock_path.is_symlink():
        raise OSError('receipt paths must not be links')
    with open(lock_path, 'a+b') as lock:
        if os.name != 'nt':
            os.fchmod(lock.fileno(), 0o600)
        locked(lock)
        try:
            record = json.loads(path.read_text(encoding='utf-8'))
        except FileNotFoundError:
            record = None
        if record is not None:
            validate_event(record['event'], key)
        ok, updated, reason = apply_command(record, command)
        if ok and command['op'] != 'gc':
            publish(path, updated)
        return {'ok': ok, 'receipt': updated, 'reason': reason}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--state-dir', required=True)
    args = parser.parse_args()
    try:
        if sys.version_info < (3, 13):
            raise RuntimeError('Python 3.13 or newer is required')
        command = json.loads(sys.stdin.read(2 * 1024 * 1024))
        print(json.dumps(transact(private_root(Path(args.state_dir)), command), ensure_ascii=False))
    except Exception as error:
        print(json.dumps({'ok': False, 'receipt': None, 'reason': f'receipt transaction failed: {type(error).__name__}: {str(error)[:240]}'}))
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
