"""Isolate two downloaded functions; no application imports, devices, files or services."""
from pathlib import Path
import argparse, ast, asyncio, hashlib, json, re, uuid
from datetime import datetime
from types import SimpleNamespace

class QuietLog:
    def __getattr__(self, name):
        return lambda *args, **kwargs: None

def load_definition(path, name, namespace):
    expected = {'TTSTaskManager': '55d94e8ddd134d4b1dd5565d6c6e7025b46a8ec05bb7a98c6eeebbc81aca55b0', 'handle_conversation_trigger': '98a285b0c956376f9c219d1802a2f027ba927b7f95f609dc04242f473305efa1'}
    if hashlib.sha256(path.read_bytes()).hexdigest() != expected[name]:
        raise ValueError('Source hash differs from the reviewed fixed commit')
    tree = ast.parse(path.read_text())
    node = next(n for n in tree.body if isinstance(n, (ast.ClassDef, ast.AsyncFunctionDef)) and n.name == name)
    module = ast.Module(body=[ast.ImportFrom(module='__future__', names=[ast.alias(name='annotations')], level=0), node], type_ignores=[])
    exec(compile(ast.fix_missing_locations(module), str(path), 'exec'), namespace)
    return namespace[name]

async def check_clear(source):
    path = source/'src/open_llm_vtuber/conversations/tts_manager.py'
    ns = {'asyncio': asyncio, 're': re, 'uuid': uuid, 'datetime': datetime, 'logger': QuietLog(), 'prepare_audio_payload': lambda **kwargs: {'type': 'audio', 'synthetic': True}}
    Manager = load_definition(path, 'TTSTaskManager', ns)
    manager = Manager()
    started, release = asyncio.Event(), asyncio.Event()
    class FakeTTS:
        async def async_generate_audio(self, **kwargs):
            started.set()
            await release.wait()
            return None
        def remove_file(self, path):
            raise AssertionError('No files should be created or removed')
    sent = []
    async def send(message):
        sent.append(message)
    await manager.speak('A deliberately blocked synthetic sentence.', SimpleNamespace(name='Synthetic'), None, None, FakeTTS(), send)
    await started.wait()
    synthesis = manager.task_list[0]
    sender = manager._sender_task
    manager.clear()
    await asyncio.sleep(0)
    remains_live = not synthesis.done() and not synthesis.cancelled()
    release.set()
    await synthesis
    await sender
    result = {'case': 'clear_during_tts_generation', 'source_sha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'synthesis_still_pending_after_clear': remains_live, 'tracked_tasks_after_clear': len(manager.task_list), 'late_payloads_in_replacement_queue': manager._payload_queue.qsize(), 'payloads_sent_after_clear': len(sent), 'scope': 'exact AST class, fake TTS and fake payload; parent conversation cancellation not exercised'}
    assert remains_live and len(manager.task_list) == 0 and manager._payload_queue.qsize() == 1 and len(sent) == 0
    return result

async def check_overlap(source):
    path = source/'src/open_llm_vtuber/conversations/conversation_handler.py'
    release, launched = asyncio.Event(), []
    async def fake_process(**kwargs):
        launched.append(kwargs['user_input'])
        await release.wait()
    ns = {'asyncio': asyncio, 'json': json, 'logger': QuietLog(), 'np': SimpleNamespace(random=SimpleNamespace(choice=lambda values: values[0])), 'EMOJI_LIST': ['synthetic'], 'process_single_conversation': fake_process}
    trigger = load_definition(path, 'handle_conversation_trigger', ns)
    tasks = {}
    group = SimpleNamespace(get_client_group=lambda client_uid: None)
    async def send(message):
        raise AssertionError('No WebSocket/network send expected in text trigger')
    websocket = SimpleNamespace(send_text=send)
    args = {'msg_type': 'text-input', 'client_uid': 'synthetic-client', 'context': SimpleNamespace(), 'websocket': websocket, 'client_contexts': {}, 'client_connections': {}, 'chat_group_manager': group, 'received_data_buffers': {}, 'current_conversation_tasks': tasks, 'broadcast_to_group': None}
    await trigger(data={'text': 'first'}, **args)
    first = tasks['synthetic-client']
    await asyncio.sleep(0)
    await trigger(data={'text': 'second'}, **args)
    second = tasks['synthetic-client']
    await asyncio.sleep(0)
    both_pending = not first.done() and not second.done()
    result = {'case': 'two_text_triggers_same_client', 'source_sha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'both_conversation_tasks_pending': both_pending, 'launched_inputs': launched[:], 'map_tracks_only_second': tasks['synthetic-client'] is second and first is not second, 'scope': 'exact AST trigger function, mocked conversation and group; frontend submission path not exercised'}
    for task in (first, second): task.cancel()
    await asyncio.gather(first, second, return_exceptions=True)
    assert both_pending and result['map_tracks_only_second'] and launched == ['first', 'second']
    return result

async def main(source, output):
    parsed = 0
    for file in source.rglob('*.py'):
        ast.parse(file.read_text(), filename=str(file)); parsed += 1
    results = [await check_clear(source), await check_overlap(source)]
    report = {'date': '2026-10-12', 'repo': 'Open-LLM-VTuber/Open-LLM-VTuber', 'sha': '992309c0aa19845960228f880013d4685fde93b5', 'python_files_parsed': parsed, 'isolated_checks_passed': len(results), 'results': results, 'application_launched': False, 'dependencies_installed': False, 'real_devices_or_models_used': False, 'does_not_prove': ['complete interruption chain', 'late audio actually played', 'ASR/TTS/model quality', 'macOS packaging', 'Aimy integration', 'persistent storage durability']}
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2))
    print(json.dumps(report, ensure_ascii=False, indent=2))

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--source-root', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    asyncio.run(main(args.source_root, args.output))
