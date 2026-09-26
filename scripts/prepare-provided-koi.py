"""Normalize the user-provided 7PLUS morph-animated GLB. Requires numpy and Pillow.

Usage: python scripts/prepare-provided-koi.py path/to/koi_fish.glb
Preserves authored appearance; does not invent a skeleton or upscale texture detail.
"""
import copy
import hashlib
import io
import json
import pathlib
import struct
import sys

import numpy as np
from PIL import Image

source = pathlib.Path(sys.argv[1]).read_bytes()
json_size = struct.unpack_from('<I', source, 12)[0]
doc = json.loads(source[20:20 + json_size])
blob = source[28 + json_size:]
primitive = doc['meshes'][0]['primitives'][0]
assert doc['asset']['extras']['source'].endswith('236859b809984f52b70c94fd040b9c59')
assert len(primitive['targets']) == 150


def read_accessor(index):
    a = doc['accessors'][index]
    v = doc['bufferViews'][a['bufferView']]
    width = {'VEC3': 3, 'VEC2': 2, 'VEC4': 4, 'SCALAR': 1}[a['type']]
    dtype = {5126: '<f4', 5125: '<u4', 5123: '<u2'}[a['componentType']]
    assert not a.get('sparse')
    item_size = np.dtype(dtype).itemsize
    return np.ndarray((a['count'], width), dtype=dtype, buffer=blob,
                      offset=v.get('byteOffset', 0) + a.get('byteOffset', 0),
                      strides=(v.get('byteStride', width * item_size), item_size)).copy()


def orient(points):
    # Source head points -X locally (+X after its original node transform).
    # Flatten that hierarchy and orient head +Z with Y remaining up.
    return points[:, [2, 1, 0]] * np.array([1, 1, -1], dtype=np.float32)


positions = orient(read_accessor(primitive['attributes']['POSITION']))
deltas = [orient(read_accessor(t['POSITION'])) for t in primitive['targets']]
# The source contains two repetitions of the same 75-pose cycle.
assert max(float(np.max(np.abs(deltas[i] - deltas[i + 75]))) for i in range(75)) < 0.0001
poses = np.stack([positions + d for d in deltas[:75]])
lower, upper = poses.min(axis=(0, 1)), poses.max(axis=(0, 1))
center = (lower + upper) / 2
scale = 0.48 / float(upper[2] - lower[2])
out_dir = pathlib.Path('public/models/koi')
out_dir.mkdir(parents=True, exist_ok=True)

for quality, frame_stride in [('high', 1), ('low', 3)]:
    binary = bytearray()
    views, accessors = [], []

    def buffer_view(data):
        while len(binary) % 4:
            binary.append(0)
        views.append({'buffer': 0, 'byteOffset': len(binary), 'byteLength': len(data)})
        binary.extend(data)
        return len(views) - 1

    def accessor(values, kind, component=5126, bounds=False):
        dtype = '<f4' if component == 5126 else '<u2'
        values = np.array(values, dtype=dtype)
        a = {'bufferView': buffer_view(values.tobytes()), 'componentType': component,
             'count': len(values), 'type': kind}
        if bounds:
            a.update(min=values.min(axis=0).reshape(-1).tolist(),
                     max=values.max(axis=0).reshape(-1).tolist())
        accessors.append(a)
        return len(accessors) - 1

    p = {'attributes': {
        'POSITION': accessor((positions - center) * scale, 'VEC3', bounds=True),
        'NORMAL': accessor(orient(read_accessor(primitive['attributes']['NORMAL'])), 'VEC3'),
        'TEXCOORD_0': accessor(read_accessor(primitive['attributes']['TEXCOORD_0']), 'VEC2'),
    }, 'indices': accessor(read_accessor(primitive['indices']), 'SCALAR', 5123),
         'material': 0, 'targets': []}
    frames = list(range(0, 75, frame_stride))
    for frame in frames:
        t = primitive['targets'][frame]
        p['targets'].append({
            'POSITION': accessor(deltas[frame] * scale, 'VEC3', bounds=True),
            'NORMAL': accessor(orient(read_accessor(t['NORMAL'])), 'VEC3'),
        })
    # First pose is duplicated at the loop endpoint, preserving seamless interpolation.
    times = np.array(frames + [75], dtype=np.float32).reshape(-1, 1) / 24
    weights = np.zeros((len(frames) + 1, len(frames)), dtype=np.float32)
    for i in range(len(frames)):
        weights[i, i] = 1
    weights[-1, 0] = 1
    animation = {'name': 'Swim', 'channels': [
        {'sampler': 0, 'target': {'node': 0, 'path': 'weights'}}],
        'samplers': [{'input': accessor(times, 'SCALAR', bounds=True),
                      'output': accessor(weights.reshape(-1, 1), 'SCALAR'),
                      'interpolation': 'LINEAR'}]}
    images = []
    for img in doc['images']:
        v = doc['bufferViews'][img['bufferView']]
        raw = blob[v.get('byteOffset', 0):v.get('byteOffset', 0) + v['byteLength']]
        texture = Image.open(io.BytesIO(raw))
        assert texture.size == (1024, 1024)
        encoded = io.BytesIO()
        texture.save(encoded, format='PNG')
        images.append({'bufferView': buffer_view(encoded.getvalue()), 'mimeType': 'image/png'})
    asset = copy.deepcopy(doc['asset'])
    asset['generator'] = 'SoftBodySim supplied koi preparation'
    asset['extras']['modifications'] = 'Normalized to 0.48m, +Z forward; loop reduced to one cycle; PNG embedding; reduced pose count in light mode.'
    result = {'asset': asset, 'scene': 0, 'scenes': [{'nodes': [0]}],
              'nodes': [{'mesh': 0, 'name': 'Koi'}],
              'meshes': [{'name': 'Koi', 'primitives': [p], 'weights': weights[0].tolist()}],
              'animations': [animation], 'materials': doc['materials'],
              'images': images, 'textures': doc['textures'], 'samplers': doc['samplers'],
              'accessors': accessors, 'bufferViews': views,
              'buffers': [{'byteLength': len(binary)}]}
    encoded_json = json.dumps(result, separators=(',', ':')).encode()
    encoded_json += b' ' * (-len(encoded_json) % 4)
    binary += b'\0' * (-len(binary) % 4)
    length = 12 + 8 + len(encoded_json) + 8 + len(binary)
    glb = struct.pack('<III', 0x46546c67, 2, length)
    glb += struct.pack('<II', len(encoded_json), 0x4e4f534a) + encoded_json
    glb += struct.pack('<II', len(binary), 0x004e4942) + binary
    (out_dir / f'7plus-{quality}.glb').write_bytes(glb)
    print(quality, len(glb), 'bytes;', len(frames), 'morph poses; length 0.48m')

print('Source SHA256:', hashlib.sha256(source).hexdigest())
