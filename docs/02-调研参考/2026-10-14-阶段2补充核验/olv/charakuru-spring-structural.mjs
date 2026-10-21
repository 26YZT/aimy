import {inspectPreviewGLTF} from './charakuru-preview-gltf.mjs';

// The final joint is a tail only in VRM 1.0. Count effective rotations,
// not declarations, and measure deformation rather than humanoid motion.
function documentOf(bytes){const b=bytes instanceof ArrayBuffer?bytes:bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);return inspectPreviewGLTF(b,'vrm');}
export function inspectSpringStructure(bytes){
 const json=documentOf(bytes),nodes=json.nodes??[],ext=json.extensions?.VRMC_springBone;
 if(json.extensions?.VRMC_vrm?.specVersion!=='1.0')throw Error('揺れもの検査にはVRM 1.0が必要です。');
 if(!ext)return {json,chains:[],colliders:0};
 if(ext.specVersion!=='1.0')throw Error('SpringBone 1.0の設定を確認してください。');
 const parent=new Map();for(let i=0;i<nodes.length;i++)for(const c of nodes[i].children??[]){if(!Number.isInteger(c)||!nodes[c]||parent.has(c))throw Error('揺れ骨の親子参照が不正です。');parent.set(c,i);}
 for(let i=0;i<nodes.length;i++){const seen=new Set();for(let n=i;parent.has(n);n=parent.get(n)){if(seen.has(n))throw Error('揺れ骨の親子関係が循環しています。');seen.add(n);}}
 const node=n=>{if(!Number.isInteger(n)||!nodes[n])throw Error('揺れ骨の参照先がありません。');return nodes[n];};
 const ancestor=(a,b)=>{while(parent.has(b)){b=parent.get(b);if(a===b)return true;}return false;};
 const finite=(v,min,max=Infinity)=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max;
 const vector=v=>Array.isArray(v)&&v.length===3&&v.every(Number.isFinite);
 for(const c of ext.colliders??[]){
  node(c.node);const shape=c.shape?.sphere??c.shape?.capsule;
  if(!shape||!vector(shape.offset)||!finite(shape.radius,0)||(c.shape.capsule&&!vector(shape.tail)))throw Error('揺れもののコライダー設定が不正です。');
 }
 for(const g of ext.colliderGroups??[])if(!Array.isArray(g.colliders)||g.colliders.some(i=>!Number.isInteger(i)||!ext.colliders?.[i]))throw Error('コライダーグループの参照が不正です。');
 const occupied=new Set(),names=new Set(),chains=[];
 for(const [index,s] of (ext.springs??[]).entries()){
  const label=s.name||`Spring ${index+1}`;
  if(names.has(label))throw Error(`${label}: チェーン名が重複しています。`);names.add(label);
  if(!Array.isArray(s.joints)||s.joints.length<2)throw Error(`${label}: 揺れ骨の末端ノードがありません。`);
  const chain=s.joints.map(j=>{node(j.node);return j.node;});
  for(let i=0;i<chain.length;i++){
   if(occupied.has(chain[i]))throw Error(`${label}: 揺れ骨が複数のチェーンに重複しています。`);occupied.add(chain[i]);
   const j=s.joints[i];
   if(!finite(j.hitRadius??0,0)||!finite(j.stiffness??1,0)||!finite(j.gravityPower??0,0)||!finite(j.dragForce??.5,0,1)||!vector(j.gravityDir??[0,-1,0]))throw Error(`${label}: 物理パラメーターが不正です。`);
   if(i&& !ancestor(chain[i-1],chain[i]))throw Error(`${label}: 揺れ骨の順序と親子関係が一致しません。`);
   if(i){let n=parent.get(chain[i]);while(n!==chain[i-1]){if(occupied.has(n))throw Error(`${label}: 経路上の揺れ骨が重複しています。`);occupied.add(n);n=parent.get(n);}}
  }
  if(s.center!==undefined){node(s.center);if(s.center!==chain[0]&&!ancestor(s.center,chain[0]))throw Error(`${label}: centerは根元またはその祖先を指定してください。`);}
  if((s.colliderGroups??[]).some(i=>!Number.isInteger(i)||!ext.colliderGroups?.[i]))throw Error(`${label}: コライダーグループがありません。`);
  const effective=new Set(chain.slice(0,-1));for(let i=1;i<chain.length;i++){let n=parent.get(chain[i]);while(n!==chain[i-1]){effective.add(n);n=parent.get(n);}}
  chains.push({name:label,nodes:chain,rotating:[...effective]});
 }
 return {json,chains,colliders:ext.colliders?.length??0};
}
function glb(json,bin){
 const text=new TextEncoder().encode(JSON.stringify(json)),jl=Math.ceil(text.length/4)*4,bl=Math.ceil(bin.length/4)*4;
 const bytes=new Uint8Array(28+jl+bl),v=new DataView(bytes.buffer);v.setUint32(0,0x46546c67,true);v.setUint32(4,2,true);v.setUint32(8,bytes.length,true);v.setUint32(12,jl,true);v.setUint32(16,0x4e4f534a,true);bytes.fill(32,20,20+jl);bytes.set(text,20);v.setUint32(20+jl,bl,true);v.setUint32(24+jl,0x004e4942,true);bytes.set(bin,28+jl);return bytes;
}
function geometryOnly(bytes,json){
 const buffer=bytes instanceof ArrayBuffer?bytes:bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),view=new DataView(buffer);
 let bin=new Uint8Array();for(let o=12;o<buffer.byteLength;){const l=view.getUint32(o,true),type=view.getUint32(o+4,true);if(type===0x004e4942)bin=new Uint8Array(buffer,o+8,l);o+=8+l;}
 // No image decoding, network or GPU is needed to evaluate the exact skin.
 const copy=structuredClone(json);copy.materials=(copy.materials??[]).map(m=>({name:m.name,pbrMetallicRoughness:{baseColorFactor:[1,1,1,1]}}));delete copy.images;delete copy.textures;
 copy.extensionsUsed=(copy.extensionsUsed??[]).filter(x=>!['VRMC_materials_mtoon','KHR_texture_transform','KHR_materials_unlit'].includes(x));
 copy.extensionsRequired=(copy.extensionsRequired??[]).filter(x=>!['VRMC_materials_mtoon','KHR_texture_transform','KHR_materials_unlit'].includes(x));
 return glb(copy,bin);
}
export function validateSpringPlan(plan){
 if(plan?.version!==1||!Array.isArray(plan.targets)||plan.targets.length>128)throw Error('部位別の揺れもの計画を保存してください。');
 const ids=new Set();for(const t of plan.targets){
  if(typeof t.mesh!=='string'||!t.mesh||ids.has(t.mesh)||!['spring','fixed'].includes(t.mode)||typeof t.source!=='string'||!t.source)throw Error('揺れもの計画の部位を確認してください。');ids.add(t.mesh);
  if(t.mode==='spring'&&(!Array.isArray(t.chains)||!t.chains.length||t.chains.some(x=>typeof x!=='string'||!x)))throw Error(`${t.mesh}: チェーンを指定してください。`);
  if(t.mode==='fixed'&&(typeof t.reason!=='string'||!t.reason.trim()))throw Error(`${t.mesh}: 固定する理由を記録してください。`);
 }
 return plan;
}
export function expectedSpringSources(project){return [...new Set([...(project.weightTransferPlan?.springObjects??[]).map(o=>o.name),...(project.assets.some(a=>a.role==='hair')?['hair']:[])])];}
export function checkSpringCoverage(plan,sources){validateSpringPlan(plan);for(const s of sources)if(!plan.targets.some(t=>t.source===s))throw Error(`${s}: 揺らすか固定するかの確認がありません。`);}
export async function verifySpringMotion(bytes,{plan,frames=90}={}){
 if(plan)validateSpringPlan(plan);
 const structure=inspectSpringStructure(bytes),{json,chains}=structure,avatar=new PreviewAvatar({scene:new THREE.Scene()});avatar.setActive(true);
 try{
  await avatar.loadVRM(new File([geometryOnly(bytes,json)],'physics-check.vrm'));
  const parser=avatar.resources.parser,loaded=new Map();
  for(let i=0;i<(json.nodes?.length??0);i++)loaded.set(i,await parser.getDependency('node',i));
  const rotating=new Map(chains.map(c=>[c.name,new Set(c.rotating.map(i=>loaded.get(i)))]));
  // A weighted child inherits its rotating ancestors too. Tail-only weights
  // are ineffective if there is no rotating ancestor in the skin's hierarchy.
  const inherits=(bone,set)=>{for(let b=bone;b;b=b.parent)if(set.has(b))return true;return false;};
  const meshes=avatar.model.getObjectsByProperty('isSkinnedMesh',true),bound=new Map(),allMeshes=[];
  for(const [i,n] of (json.nodes??[]).entries())if(n.mesh!==undefined){const root=loaded.get(i);for(const m of root.getObjectsByProperty('isMesh',true))if(!allMeshes.some(x=>x.mesh===m))allMeshes.push({mesh:m,name:n.name||json.meshes[n.mesh]?.name||m.name});}
  for(const t of plan?.targets??[])if(!allMeshes.some(x=>x.name===t.mesh||x.mesh.name===t.mesh))throw Error(`${t.mesh}: 書き出したVRMに対象部位がありません。`);
  for(const c of chains){const set=rotating.get(c.name),affected=[];
   for(const m of meshes){const si=m.geometry.attributes.skinIndex,sw=m.geometry.attributes.skinWeight;let count=0;
    for(let i=0;i<si.count;i++){let weight=0;for(let k=0;k<4;k++)if(inherits(m.skeleton.bones[si.getComponent(i,k)],set))weight+=sw.getComponent(i,k);if(weight>1e-5)count++;}
    if(count)affected.push(m);
   }
   for(const {mesh:m} of allMeshes)if(!m.isSkinnedMesh&&inherits(m,set))affected.push(m);
   if(!affected.length)throw Error(`${c.name}: 揺れ骨に追従する頂点・部品がありません。`);
   bound.set(c.name,affected);
  }
  const targets=plan?.targets.filter(t=>t.mode==='spring')??chains.flatMap(c=>(bound.get(c.name)||[]).map(m=>({mesh:allMeshes.find(x=>x.mesh===m)?.name||m.name,chains:[c.name]})));
  if(!chains.length&&targets.length)throw Error('VRMに必要なSpringBoneがありません。');
  const watched=new Map();for(const t of targets){const matches=allMeshes.filter(x=>x.name===t.mesh||x.mesh.name===t.mesh).map(x=>x.mesh);
   if(!matches.length)throw Error(`${t.mesh}: 書き出したVRMに対象部位がありません。`);
   for(const c of t.chains)if(!bound.has(c)||!matches.some(m=>bound.get(c).includes(m)))throw Error(`${t.mesh}: ${c}の揺れ骨ウェイトがありません。`);
   watched.set(t.mesh,matches);
  }
  const pose=new Map();avatar.model.traverse(o=>pose.set(o,{p:o.position.clone(),q:o.quaternion.clone(),s:o.scale.clone()}));
  const sampleIndices=new Map();
  const activeBones=new Set([...rotating.values()].flatMap(s=>[...s]));
  for(const ms of watched.values())for(const m of ms){const candidates=[],a=m.geometry.attributes.position,si=m.geometry.attributes.skinIndex,sw=m.geometry.attributes.skinWeight;
   for(let i=0;i<a.count;i++)if(!m.isSkinnedMesh||[0,1,2,3].some(k=>sw.getComponent(i,k)>1e-5&&inherits(m.skeleton.bones[si.getComponent(i,k)],activeBones)))candidates.push(i);
   // Sample from the actually affected vertices, so a small tassel in a large
   // combined mesh cannot fall between the uniform sample positions.
   sampleIndices.set(m,candidates.filter((_,i)=>i%Math.max(1,Math.ceil(candidates.length/512))===0));
  }
  const points=m=>{const a=m.geometry.attributes.position,result=[];for(const i of sampleIndices.get(m)){const p=new THREE.Vector3().fromBufferAttribute(a,i);if(m.isSkinnedMesh)m.applyBoneTransform(i,p);result.push(p.applyMatrix4(m.matrixWorld));}return result;};
  const samples=new Map([...watched].map(([n])=>[n,[]])),response=new Map([...watched].map(([n])=>[n,0]));
  const boneSamples=new Map(),chainResponse=new Map(chains.map(c=>[c.name,0]));
  for(const enabled of [false,true]){
   for(const [o,p] of pose){o.position.copy(p.p);o.quaternion.copy(p.q);o.scale.copy(p.s);}avatar.model.updateMatrixWorld(true);avatar.springManager?.reset();
   const parents=new Set(chains.map(c=>loaded.get(c.nodes[0])?.parent).filter(Boolean));
   for(let frame=0;frame<frames;frame++){
    const time=frame/60;for(const p of parents){const rest=pose.get(p);p.quaternion.copy(rest.q).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(.18*Math.sin(time*5),.2*Math.sin(time*4),.16*Math.sin(time*6))));}
    avatar.model.updateMatrixWorld(true);if(enabled)avatar.springManager?.update(1/60);avatar.model.updateMatrixWorld(true);
    for(const c of chains){const quaternions=[...rotating.get(c.name)].map(o=>o.quaternion.clone());
     if(!enabled){if(!boneSamples.has(c.name))boneSamples.set(c.name,[]);boneSamples.get(c.name).push(quaternions);}
     else{const reference=boneSamples.get(c.name)[frame];for(let i=0;i<quaternions.length;i++)chainResponse.set(c.name,Math.max(chainResponse.get(c.name),quaternions[i].angleTo(reference[i])));}
    }
    for(const [n,ms] of watched){const current=ms.flatMap(points);if(current.some(v=>!v.toArray().every(Number.isFinite)))throw Error(`${n}: 揺れが発散しています。`);
     if(!enabled)samples.get(n).push(current);else{const reference=samples.get(n)[frame];let max=0;for(let i=0;i<current.length;i++)max=Math.max(max,current[i].distanceTo(reference[i]));response.set(n,Math.max(response.get(n),max));}
    }
   }
  }
  const height=new THREE.Box3().setFromObject(avatar.model).getSize(new THREE.Vector3()).length(),threshold=Math.max(1e-7,height*1e-6);
  for(const [n,angle] of chainResponse)if(!Number.isFinite(angle)||angle<=1e-5)throw Error(`${n}: 物理ON/OFFで揺れ骨が動きません。`);
  for(const [n,d] of response)if(d<=threshold)throw Error(`${n}: 物理ON/OFFで頂点が動きません。末端・ウェイト・center・強さを確認してください。`);
  return {version:1,chains:chains.length,joints:avatar.springCount,colliders:structure.colliders,chainResponses:[...chainResponse].map(([chain,maxPhysicsAngle])=>({chain,maxPhysicsAngle})),targets:[...response].map(([mesh,maxPhysicsDisplacement])=>({mesh,maxPhysicsDisplacement})),fixed:plan?.targets.filter(t=>t.mode==='fixed')??[],frames,threshold};
 }finally{avatar.dispose();}
}
