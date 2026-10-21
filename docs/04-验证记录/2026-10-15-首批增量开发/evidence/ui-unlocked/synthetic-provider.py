from http.server import ThreadingHTTPServer,BaseHTTPRequestHandler
from pathlib import Path
import json,time,sys
base=Path('/tmp/aimy-first-implementation-20261015/ui-unlocked')
class Handler(BaseHTTPRequestHandler):
 def log_message(self,*args): pass
 def headers_out(self,status=200,content='application/json'):
  self.send_response(status);self.send_header('Content-Type',content);self.send_header('Access-Control-Allow-Origin','*');self.send_header('Access-Control-Allow-Headers','*');self.send_header('Access-Control-Allow-Methods','GET,POST,OPTIONS');self.end_headers()
 def do_OPTIONS(self): self.headers_out()
 def do_GET(self):
  self.headers_out();self.wfile.write(json.dumps({'object':'list','data':[{'id':'synthetic-memory','object':'model','owned_by':'Aimy offline integration test'}]}).encode())
 def do_POST(self):
  body=json.loads(self.rfile.read(int(self.headers.get('Content-Length','0'))))
  def text(m):
   c=m.get('content','');return c if isinstance(c,str) else '\n'.join(x.get('text','') for x in c if isinstance(x,dict))
  messages=body.get('messages',[]);system='\n'.join(text(m) for m in messages if m.get('role')=='system');kind='chat'
  output='这是离线测试模型的回应，用于验证界面和数据流。'
  if '记忆候选整理任务' in system:
   kind='memory';data=json.loads(text(messages[-1]));candidates=[]
   for src in data.get('allowedSources',[]):
    if '乌龙茶' in src['text']:
     candidates.append({'category':'preference','subject':'user','label':'饮品偏好','text':'用户喜欢喝乌龙茶。','keywords':['喝','茶','饮品'],'sourceRefIds':[src['ref']['sourceId']]})
   output=json.dumps({'schemaVersion':1,'candidates':candidates},ensure_ascii=False)
  elif '乌龙茶' in system: output='测试团团，可以泡一杯你喜欢的乌龙茶。这是离线测试回应。'
  record={'at':time.time(),'path':self.path,'model':body.get('model'),'kind':kind,'stream':bool(body.get('stream')),'has_memory_evidence':'User memory evidence' in system,'has_oolong':'乌龙茶' in system,'max_tokens':body.get('max_tokens'),'request_bytes':len(json.dumps(body).encode())}
  with (base/'synthetic-provider-requests.jsonl').open('a') as f:f.write(json.dumps(record)+'\n')
  if body.get('stream'):
   self.headers_out(content='text/event-stream')
   chunk={'id':'synthetic','object':'chat.completion.chunk','model':'synthetic-memory','choices':[{'index':0,'delta':{'content':output},'finish_reason':'stop'}],'usage':{'prompt_tokens':10,'completion_tokens':10,'total_tokens':20}}
   self.wfile.write(('data: '+json.dumps(chunk)+'\n\ndata: [DONE]\n\n').encode())
  else:
   self.headers_out();self.wfile.write(json.dumps({'id':'synthetic','object':'chat.completion','choices':[{'index':0,'message':{'role':'assistant','content':output},'finish_reason':'stop'}],'usage':{'prompt_tokens':10,'completion_tokens':10,'total_tokens':20}}).encode())
server=ThreadingHTTPServer(('127.0.0.1',53554),Handler)
(base/'synthetic-provider-port.txt').write_text(str(server.server_port))
print('Synthetic local provider on port',server.server_port,flush=True)
server.serve_forever()
