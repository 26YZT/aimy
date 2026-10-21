from pathlib import Path
import ast,json,math,hashlib
import bpy
from mathutils import Matrix,Vector,Euler,kdtree
OUT=Path('/tmp/aimy-20261014-remaining-charakuru')
source=Path('/tmp/charakuru-extract/charakuru-1.0.4-2026-10-12T17-55-01-211Z/scripts/production.py');raw=source.read_bytes();tree=ast.parse(raw);names={'bounds','piece','join','restore_uv'};nodes=[n for n in tree.body if isinstance(n,ast.FunctionDef)and n.name in names];exec(compile(ast.fix_missing_locations(ast.Module(body=nodes,type_ignores=[])),str(source),'exec'),globals())
# Separate factory process only; never attaches to the running Blender/MCP scene.
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
def quad(name,verts=None,faces=None):
 mesh=bpy.data.meshes.new(name);mesh.from_pydata(verts or[(0,0,0),(1,0,0),(1,1,0),(0,1,0)],[],faces or[(0,1,2,3)]);mesh.update();obj=bpy.data.objects.new(name,mesh);bpy.context.scene.collection.objects.link(obj);uv=mesh.uv_layers.new(name='UVMap')
 for loop,p in zip(uv.data,[(0,0),(1,0),(1,1),(0,1)]):loop.uv=p
 return obj
original=quad('Original');cut=piece(original,[0,1,2,3],'CopiedComponent');assert len(cut.data.polygons)==1 and len(cut.data.polygons[0].vertices)==4;assert all(tuple(a.uv)==tuple(b.uv)for a,b in zip(original.data.uv_layers.active.data,cut.data.uv_layers.active.data))
copy_b=piece(original,[0,1,2,3],'SecondCopy');copy_b.location.x=2;merged=join([cut,copy_b],'JoinedCopies');assert len(merged.data.polygons)==2
try:piece(original,[0,1,2],'BadBoundary')
except ValueError:bad_boundary=True
else:raise AssertionError('bad boundary accepted')
returned=quad('Returned',[(10,20,0),(12,20,0),(12,22,0),(10,22,0)]);image=bpy.data.images.new('SyntheticBlank4K',width=4096,height=4096);mat=bpy.data.materials.new('SyntheticTexture');mat.use_nodes=True;node=mat.node_tree.nodes.new('ShaderNodeTexImage');node.image=image;bsdf=next(n for n in mat.node_tree.nodes if n.type=='BSDF_PRINCIPLED');mat.node_tree.links.new(node.outputs['Color'],bsdf.inputs['Base Color']);returned.data.materials.append(mat)
for loop,p in zip(returned.data.uv_layers.active.data,[(.1,.2),(.8,.2),(.8,.9),(.1,.9)]):loop.uv=p
before=[tuple(v.co)for v in original.data.vertices];result=restore_uv([original],[returned]);assert before==[tuple(v.co)for v in original.data.vertices];assert all((a.uv-b.uv).length<1e-6 for a,b in zip(original.data.uv_layers.active.data,returned.data.uv_layers.active.data))
bad=quad('BadTopology',[(10,20,0),(12,20,0),(10,22,0)],[(0,1,2)]);bad.data.materials.append(mat)
try:restore_uv([original],[bad])
except ValueError:bad_topology=True
else:raise AssertionError('changed topology accepted')
report={'blender':bpy.app.version_string,'factory_startup':True,'current_user_scene_touched':False,'executed_original_functions':sorted(names),'source_sha256':hashlib.sha256(raw).hexdigest(),'component_topology_UV_preserved':True,'partial_face_boundary_rejected':bad_boundary,'joined_mesh_faces':len(merged.data.polygons),'restoreUV':result,'original_vertices_preserved':True,'changed_topology_rejected':bad_topology,'vrm_addon_enabled_in_factory':hasattr(bpy.types.Material,'vrm_addon_extension'),'limits':['no Tripo/generated candidate/donor/user project','no full assembly/rig/weights/MToon export','blank in-memory texture, not generated artwork; no render/save user scene']};(OUT/'blender-production-results.json').write_text(json.dumps(report,ensure_ascii=False,indent=2));print(json.dumps(report,ensure_ascii=False))
