import unittest
from skill_contract_calls import extract_calls


class SignatureTest(unittest.TestCase):
    def test_unknown_names_and_actions_are_rejected_even_for_fragments(self):
        from skill_contract_calls import validate_signature
        schema = {"properties": {"action": {"enum": ["find"]}, "kind": {}}, "required": ["action"]}
        for call in ({"action": "fnd"}, {"action": "find", "knd": "spec"}):
            with self.subTest(call=call), self.assertRaises(ValueError):
                validate_signature(call, schema)
        validate_signature({"action": "find", "kind": "spec"}, schema)


class ExtractCallsTest(unittest.TestCase):
    def test_reads_multiline_calls_and_preserves_quoted_content(self):
        text = 'doc(action="find",\n filter={tags: {contains: "true, key: doc("}}, include_archived=true)\nmemory(action="write", topic="x", content="a ) and \\"quote\\"")'
        calls = extract_calls(text)
        self.assertEqual([(c[0], c[1]) for c in calls], [
            ("doc", {"action": "find", "filter": {"tags": {"contains": "true, key: doc("}}, "include_archived": True}),
            ("memory", {"action": "write", "topic": "x", "content": 'a ) and "quote"'}),
        ])
        self.assertEqual([c[3] for c in calls], [1, 3])

    def test_fills_only_unquoted_placeholders_and_retains_partial_shapes(self):
        calls = extract_calls('workspace(action="activate", path=<target>, read_only=false)\ndoc(action="update", id=…, patch={body_edits: […]})\nworkspace(action="activate", ...)')
        self.assertEqual(len(calls), 3)
        self.assertEqual(calls[0][1], {"action": "activate", "path": "<target>", "read_only": False})
        self.assertEqual(calls[1][1], {"action": "update", "id": Ellipsis, "patch": {"body_edits": [Ellipsis]}})
        self.assertEqual(calls[2][1], {"action": "activate"})

    def test_unclosed_or_nonliteral_calls_fail_loudly(self):
        for text in ('doc(action="find"', 'doc(action="find", kind=unknown)'):
            with self.subTest(text=text), self.assertRaises(ValueError):
                extract_calls(text)

    def test_nested_mentions_inside_strings_are_not_calls(self):
        calls = extract_calls('memory(action="write", topic="x", content=\'doc(action="find")\')')
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0][0], "memory")
class DiscoveryTest(unittest.TestCase):
    def test_all_five_tool_families_are_discovered(self):
        text = '\n'.join([
            'doc(action="find")',
            'librarian(action="doctor")',
            'index(action="verify")',
            'memory(action="list")',
            'workspace(action="status")',
        ])
        self.assertEqual([call[0] for call in extract_calls(text)],
                         ["doc", "librarian", "index", "memory", "workspace"])

    def test_action_need_not_be_the_first_keyword(self):
        calls = extract_calls('doc(kind="spec", action="find")\nworkspace(path="<target>", action="activate")')
        self.assertEqual([(c[0], c[1]["action"]) for c in calls], [("doc", "find"), ("workspace", "activate")])

    def test_unquoted_action_is_not_silently_skipped(self):
        with self.assertRaises(ValueError):
            extract_calls("doc(action=unknown)")

    def test_shorthand_mentions_are_not_executable_examples(self):
        self.assertEqual(extract_calls("doc(find), memory(write), index(verify) and doc()"), [])





if __name__ == "__main__":
    unittest.main()
