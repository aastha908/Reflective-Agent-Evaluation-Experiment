"""Offline contract tests for provider authentication and request routing."""
import json
import unittest
from unittest.mock import MagicMock, patch

from app.providers import provider_for


class ProviderTests(unittest.TestCase):
    def respond(self, provider, env, model=""):
        response = MagicMock()
        response.__enter__.return_value.read.return_value = json.dumps(
            {"choices": [{"message": {"content": '{"final_response":"done"}'}}]}
        ).encode()
        with patch.dict("os.environ", env, clear=True), patch(
            "app.providers.urlopen", return_value=response
        ) as transport:
            result = provider_for(provider).respond(
                [{"role": "user", "content": "test"}],
                {"model": model, "temperature": 0},
            )
        self.assertEqual(result, '{"final_response":"done"}')
        return transport.call_args.args[0]

    def test_openai_default_endpoint_and_bearer(self):
        request = self.respond("openai_compatible", {"LLM_API_KEY": "test-openai", "LLM_MODEL": "configured"})
        self.assertEqual(request.full_url, "https://api.openai.com/v1/chat/completions")
        self.assertEqual(request.get_header("Authorization"), "Bearer test-openai")
        self.assertIsNone(request.get_header("Api-key"))
        self.assertEqual(json.loads(request.data)["model"], "configured")

    def test_hkust_uses_only_its_key_and_model(self):
        request = self.respond("hkust", {"HKUST_API_KEY": "test-hkust", "HKUST_MODEL": "hkust-model", "LLM_API_KEY": "other", "LLM_MODEL": "other"})
        self.assertEqual(request.full_url, "https://hkust.azure-api.net/hkust-genai/v1/chat/completions")
        self.assertEqual(request.get_header("Api-key"), "test-hkust")
        self.assertIsNone(request.get_header("Authorization"))
        self.assertEqual(json.loads(request.data)["model"], "hkust-model")

    def test_custom_endpoint_and_model_override(self):
        request = self.respond("openai_compatible", {"LLM_API_BASE_URL": "https://example.test/v1/", "LLM_API_KEY": "test", "LLM_MODEL": "default"}, model="override")
        self.assertEqual(request.full_url, "https://example.test/v1/chat/completions")
        self.assertEqual(json.loads(request.data)["model"], "override")

    def test_missing_hkust_settings_fail_before_network(self):
        with patch.dict("os.environ", {"LLM_API_KEY": "other"}, clear=True), patch("app.providers.urlopen") as transport:
            with self.assertRaisesRegex(RuntimeError, "HKUST_API_KEY"):
                provider_for("hkust").respond([], {"model": "", "temperature": 0})
            transport.assert_not_called()


if __name__ == "__main__":
    unittest.main()
