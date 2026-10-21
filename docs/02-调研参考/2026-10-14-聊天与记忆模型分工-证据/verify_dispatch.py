import ast
import asyncio
import json
import sys
import types
from pathlib import Path

ROOT = Path("/Users/mima1234/Documents/资料/拆解项目")
RESULTS = []
CALLS = []

def record(name, condition):
    assert condition, name
    RESULTS.append({"name": name, "passed": True})

def load_function(path, name, namespace):
    tree = ast.parse(path.read_text())
    node = next(n for n in tree.body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name == name)
    module = ast.Module(body=[ast.ImportFrom(module="__future__", names=[ast.alias(name="annotations")], level=0), node], type_ignores=[])
    ast.fix_missing_locations(module)
    exec(compile(module, str(path), "exec"), namespace)
    return namespace[name]

async def run():
    memory = types.ModuleType("memory")
    providers = types.ModuleType("ai_providers")
    parser = types.ModuleType("model_json")
    cfg = {"ready": True, "provider": "codex", "model": "fake-profile-A"}

    async def codex(prompt, **kwargs):
        CALLS.append({"route": "codex", **kwargs})
        return '{"updates": []}'

    async def sentinel(config, prompt, **kwargs):
        CALLS.append({"route": "sentinel", "model": config["model"], **kwargs})
        return '{"updates": []}'

    memory._call_sentinel_text = sentinel
    providers.call_codex_sentinel = codex
    parser.extract_json_object = json.loads
    sys.modules.update(memory=memory, ai_providers=providers, model_json=parser)
    ns = {"get_sentinel_config": lambda: cfg, "_Analysis": type("_Analysis", (dict,), {})}
    fn = load_function(ROOT/"AionsHome-main/aion-chat/post_sentinel.py", "_call_model", ns)
    await fn("synthetic-only")
    record("aions_profile_codex_uses_its_configured_model", CALLS[-1]["model"] == "fake-profile-A")
    record("aions_profile_codex_does_not_use_chat_slot", CALLS[-1]["use_chat_slot"] is False)
    cfg = {"ready": True, "provider": "openai_compatible", "model": "fake-profile-B"}
    await fn("synthetic-only")
    record("aions_profile_original_route_uses_separate_config", CALLS[-1]["route"] == "sentinel" and CALLS[-1]["model"] == "fake-profile-B")
    cfg = {"ready": False}
    before = len(CALLS)
    try:
        await fn("synthetic-only")
    except RuntimeError:
        record("aions_missing_profile_config_fails_before_call", len(CALLS) == before)
    else:
        raise AssertionError("expected configuration error")

    async def simple(messages, model):
        CALLS.append({"route": "compression", "model": model})
        return '{"ok": true}'
    ns = {"simple_ai_call": simple, "_parse_json_response": json.loads}
    fn = load_function(ROOT/"AionsHome-main/aion-chat/memory_compression.py", "_call_compression_model", ns)
    await fn("fake-compression-A", "synthetic-only")
    await fn("fake-compression-B", "synthetic-only")
    record("aions_compression_passes_the_explicit_model_per_call", [c["model"] for c in CALLS[-2:]] == ["fake-compression-A", "fake-compression-B"])

    path = ROOT/"kirara-ai-master/kirara_ai/workflow/implementations/blocks/llm/chat.py"
    tree = ast.parse(path.read_text())
    cls = next(n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == "ChatCompletion")
    method = next(n for n in cls.body if isinstance(n, ast.FunctionDef) and n.name == "execute")
    routes = []
    selected = []
    class Manager:
        def get_llm_id_by_ability(self, ability):
            routes.append("default")
            return "fake-chat"
        def get_llm(self, model):
            selected.append(model)
            if model == "missing":
                return None
            return types.SimpleNamespace(chat=lambda req: routes.append(req.model) or "fake-output")
    manager = Manager()
    ns = {"LLMManager": object(), "LLMAbility": types.SimpleNamespace(TextChat="text"), "LLMChatRequest": lambda **kw: types.SimpleNamespace(**kw)}
    module = ast.Module(body=[ast.ImportFrom(module="__future__", names=[ast.alias(name="annotations")], level=0), method], type_ignores=[])
    ast.fix_missing_locations(module)
    exec(compile(module, str(path), "exec"), ns)
    host = types.SimpleNamespace(model_name="fake-chat", container=types.SimpleNamespace(resolve=lambda token: manager), logger=types.SimpleNamespace(info=lambda *_: None, debug=lambda *_: None))
    ns["execute"](host, [])
    host.model_name = "fake-memory"
    ns["execute"](host, [])
    record("kirara_distinct_llm_blocks_can_route_to_distinct_models", selected[-2:] == ["fake-chat", "fake-memory"])
    host.model_name = None
    ns["execute"](host, [])
    record("kirara_unspecified_block_uses_default_text_model", routes[-2:] == ["default", "fake-chat"])
    host.model_name = "missing"
    before = len(routes)
    try:
        ns["execute"](host, [])
    except ValueError:
        record("kirara_unknown_explicit_model_does_not_silently_fallback", len(routes) == before)
    else:
        raise AssertionError("expected missing model error")

    out = {"kind":"isolated_original_ast_dispatch", "real_model_calls": 0, "real_credentials_read": False, "checks": RESULTS, "calls": CALLS, "scope":"Original selected dispatch functions; config, parser and remote calls replaced by synthetic stubs. Not semantic memory quality."}
    Path(__file__).with_name("python-results.json").write_text(json.dumps(out, ensure_ascii=False, indent=2)+"\n")
    print(json.dumps({"checks":len(RESULTS),"passed":all(v["passed"] for v in RESULTS),"real_model_calls":0}))
asyncio.run(run())

