// Reject dependencies before the official loader runs. Local files are parsed
// in the browser; no files or texture URLs are sent to a service.
export function inspectPreviewGLTF(buffer,kind) {
  if(!(buffer instanceof ArrayBuffer)||buffer.byteLength<20||buffer.byteLength>(kind==='vrma'?32:128)*1024*1024)throw Error('ファイルのサイズ・形式を確認してください。');
  const view=new DataView(buffer);let json,binLength=0;
  try{
    if(view.getUint32(0,true)===0x46546c67){
      if(view.getUint32(4,true)!==2||view.getUint32(8,true)!==buffer.byteLength)throw Error();
      let offset=12,first=true;
      while(offset<buffer.byteLength){
        if(offset+8>buffer.byteLength)throw Error();const length=view.getUint32(offset,true),type=view.getUint32(offset+4,true);offset+=8;
        if(length%4||offset+length>buffer.byteLength)throw Error();
        if(first&&type!==0x4e4f534a)throw Error();
        if(type===0x4e4f534a){if(json||length>4*1024*1024)throw Error();json=JSON.parse(new TextDecoder().decode(new Uint8Array(buffer,offset,length)));}
        else if(type===0x004e4942)binLength+=length;else throw Error();offset+=length;first=false;
      }
    }else{if(buffer.byteLength>4*1024*1024)throw Error();json=JSON.parse(new TextDecoder().decode(buffer));}
  }catch{throw Error('VRM/VRMAの内容が壊れているか、対応していない形式です。');}
  if(json?.asset?.version!=='2.0')throw Error('glTF 2.0のVRM/VRMAを選んでください。');
  const extensions=json.extensions??{};
  if(kind==='vrm'&&!extensions.VRMC_vrm&&!extensions.VRM)throw Error('VRMモデルを選んでください。');
  if(kind==='vrma'&&!extensions.VRMC_vrm_animation)throw Error('VRMAモーションを選んでください。');
  if(kind==='vrma'&&extensions.VRMC_vrm_animation.specVersion!=='1.0')throw Error('VRMA 1.0に対応しています。');
  if(extensions.VRMC_vrm&&extensions.VRMC_vrm.specVersion!=='1.0')throw Error('VRM 1.0、またはVRM 0.xに対応しています。');
  for(const entry of [...(json.buffers??[]),...(json.images??[])]){
    if(entry.uri!==undefined&&(typeof entry.uri!=='string'||!/^data:(application\/octet-stream|application\/gltf-buffer|image\/(png|jpeg|webp));base64,[A-Za-z0-9+/=]+$/.test(entry.uri)))throw Error('外部ファイル参照を含むモデルは読み込めません。テクスチャを埋め込んでください。');
  }
  if((json.nodes?.length??0)>20000||(json.accessors?.length??0)>10000)throw Error('モデルの構造が大きすぎます。');
  for(const b of json.buffers??[])if(!Number.isSafeInteger(b.byteLength)||b.byteLength<0||b.byteLength>128*1024*1024||(!b.uri&&b.byteLength>binLength))throw Error('モデルのバッファが不正です。');
  const nodes=json.nodes??[];
  const visited=new Set(),path=new Set();
  function visit(id,depth=0){
    if(!Number.isInteger(id)||id<0||id>=nodes.length||depth>128||path.has(id))throw Error('モデルの親子構造が不正です。');
    if(visited.has(id))return;
    const node=nodes[id];
    if(!node||typeof node!=='object')throw Error('モデルのノードが不正です。');
    for(const [key,count] of [['translation',3],['rotation',4],['scale',3],['matrix',16]])if(node[key]!==undefined&&(!Array.isArray(node[key])||node[key].length!==count||node[key].some(v=>!Number.isFinite(v))))throw Error('モデルの座標が不正です。');
    if(node.children!==undefined&&!Array.isArray(node.children))throw Error('モデルの親子構造が不正です。');
    path.add(id);for(const child of node.children??[])visit(child,depth+1);path.delete(id);visited.add(id);
  }
  for(let id=0;id<nodes.length;id++)visit(id);
  for(const accessor of json.accessors??[])if(!Number.isSafeInteger(accessor.count)||accessor.count<0||accessor.count>16000000)throw Error('モデルの頂点・モーション数が不正です。');
  return json;
}
