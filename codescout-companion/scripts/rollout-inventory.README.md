# Inventarul de trecere CodeScout

Acest diagnostic pregătește inventarul pentru Albert înainte de o trecere coordonată. Rulează pe Linux cu Python3.11 sau mai nou, fără dependențe suplimentare. Python3.12.3 din raportul laptopului este suficient. Nu schimbă profilul CPU și nu configurează GPU.

## Rulare

Din checkoutul claude-plugins, într-un terminal cu vizibilitatea obișnuită a gazdei:

```sh
python3 -B codescout-companion/scripts/rollout-inventory.py \
  --project /cale/absoluta/proiect \
  --launcher /cale/absoluta/bridge-sau-wrapper \
  > inventar-codescout.json
```

Repetă --project pentru fiecare proiect și --launcher pentru bridgeuri, wrapperi sau lansatoare care au nume generice. --home poate selecta un alt home de inspectat. --skip-runtime omite probele systemctl/crontab și raportează explicit acest lucru. --proc-root este destinat fixturelor/testelor; valoarea obișnuită este /proc.

Fișierul rezultat conține căi locale și identități de proces. Păstrează-l privat pentru revizuire; poți trimite doar părțile relevante. Argumentele complete, valorile arbitrare de mediu, URL-urile și conținutul topicurilor nu sunt incluse. Cheile de backend cunoscute sunt raportate prin prezență, iar valorile de stocare sunt incluse numai pentru căi locale absolute sau ~/; căile relative/dinamice rămân nerezolvate. Mesajele de eroare ale parserelor și stderrul comenzilor sunt omise.

## Ce măsoară

- Configurațiile MCP din .mcp.json, .claude.json, Pi și profilurile .codex/.Codex/.Codex-sdd/.Codex-kat; profilurile Claude uzuale și rădăcinile indicate de CODEX_HOME/CLAUDE_CONFIG_DIR.
- Comenzile configurate, căile --project declarate, identitatea proiectelor din .claude.json și overrideurile LIBRARIAN_DB, LIBRARIAN_WORKSPACE, LIBRARIAN_CWD și CODESCOUT_SQLITE_DIR. Moștenirile și valorile implicite nu sunt presupuse.
- Lansatoarele explicite, symlinkurile CodeScout uzuale și extensiile Pi cu CodeScout în nume; SHA256 pentru fișierele accesibile, cu limită de dimensiune.
- Procesele candidate vizibile cu UIDul real curent, potrivite după nume de executabil/argument sau calea unui lansator cunoscut. Pot exista false pozitive; lista nu certifică writerii. Pentru fiecare candidat: PID/PPID, start_time_ticks, executabilul și hashul inode-ului vizibil prin /proc/PID/exe, cwd, unități cgroup și bindinguri de stocare observate în mediu. Executabilele șterse încă mapate sunt marcate. PPID0/1 indică doar un candidat detașat.
- Fișiere systemd, cron și autostart care referă CodeScout sau wrapperii expliciți; probe de citire systemctl pentru managerii user/system și crontab -l. Restart, stări, unități declanșatoare și MainPID sunt inventariate când sunt accesibile.
- Directoare existente din layoutul public/privat și subproiectele selectate; acestea sunt candidați de stocare, nu o certificare a namespace-urilor.

Scriptul execută numai /usr/bin/systemctl în modurile list-unit-files/show și /usr/bin/crontab -l. Nu execută binarul CodeScout, wrapperii sau clienții, nu deschide baze SQLite și nu citește fișierele topicurilor. Nu instalează, nu oprește procese, nu migrează și nu scrie configurații. Singura scriere din exemplu este redirecționarea stdout făcută de shell.

## Ce rămâne de completat

inventory_complete, activation_ready și execution_authorized sunt întotdeauna false. Exit0 înseamnă numai că raportul JSON a fost generat. O listă goală sau status not_found nu demonstrează că alte lansatoare nu există. Verifică fiecare scope, unavailable și over_limit; limitele sunt 1MiB pentru citiri text/proc, 512MiB pentru hashuri, 10000 PIDuri și 2000 fișiere pe scope de controllere. Rădăcinile/proiectele nespecificate și directoarele symlink nu sunt parcurse recursiv.

Reconcilează inventarul cu manifestul de activare pregătit anterior. Completează comenzile originale/noi în evidența privată, controllerii care pot reporni writerii, toate stocările efective și fallbackurile. Verifică separat clienții nativi și profilurile instalate; configurația observată nu demonstrează acceptanța runtime.

Înainte de aplicare rămân necesare repetiția pe copiile aprobate, inhibarea coordonată a repornirilor, oprirea writerilor aprobați, backupul proaspăt coerent și proba de restaurare/revenire. Raportul nu acordă aprobarea aplicării. JSONul de dovezi al guardului Pi trebuie încă reconciliat.
