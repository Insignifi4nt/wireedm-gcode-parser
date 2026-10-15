"""Add exact indexed topology extractors, preserving the original hash APIs."""
from pathlib import Path
import difflib
import sys

root = Path(sys.argv[1]).resolve()
sources = root / "src/wrappers"
originals = root.parent / "indexed-originals"
originals.mkdir(exist_ok=True)
changes = {}

def replace(text, before, after):
    assert text.count(before) == 1, before
    return text.replace(before, after)

def modify(name, transform, config=False):
    source = (root / "src" if config else sources) / name
    backup = originals / name
    if backup.exists():
        assert "--refresh" in sys.argv, "Preserve exact originals."
        before = backup.read_text()
    else:
        before = source.read_text()
        backup.write_text(before)
    after = transform(before)
    source.write_text(after)
    changes[name if config else "wrappers/" + name] = (before, after)

def faces(text):
    text = '#include <TopTools_IndexedMapOfShape.hxx>\n' + text
    text = replace(text, '  bool skipNormals);', '  bool skipNormals,\n  bool indexedTopology);')
    text = replace(text, '    const TopoDS_Shape&,\n    bool);', '    const TopoDS_Shape&,\n    bool,\n    bool);')
    text = replace(text, '  bool skipNormals\n) {\n  int totalNodes', '  bool skipNormals,\n  bool indexedTopology = false\n) {\n  TopTools_IndexedMapOfShape topology;\n  if (indexedTopology) for (TopExp_Explorer it(shape, TopAbs_FACE); it.More(); it.Next()) topology.Add(it.Current());\n  int totalNodes')
    text = replace(text, 'ReplicadShapeHashCode(face, ReplicadShapeHashUpperBound);', 'indexedTopology ? topology.FindIndex(face) : ReplicadShapeHashCode(face, ReplicadShapeHashUpperBound);')
    end = '    return ReplicadExtractFaceMesh(shape, skipNormals);\n  }\n};'
    text = replace(text, end, end[:-3] + '''
  static ReplicadMeshData extractWithTopologyIndices(
    const TopoDS_Shape& shape,
    double tolerance,
    double angularTolerance,
    bool skipNormals
  ) {
    mesh(shape, tolerance, angularTolerance);
    return ReplicadExtractFaceMesh(shape, skipNormals, true);
  }
};''')
    return text

def edges(text):
    text = '#include <TopTools_IndexedMapOfShape.hxx>\n' + text
    text = replace(text, '  double angularTolerance);', '  double angularTolerance,\n  bool indexedTopology);')
    text = replace(text, '    const TopoDS_Shape&,\n    double,\n    double);', '    const TopoDS_Shape&,\n    double,\n    double,\n    bool);')
    text = replace(text, '  double angularTolerance\n) {\n  ReplicadEnsureEdgeMesh', '  double angularTolerance,\n  bool indexedTopology = false\n) {\n  TopTools_IndexedMapOfShape topology;\n  if (indexedTopology) for (TopExp_Explorer it(shape, TopAbs_EDGE); it.More(); it.Next()) topology.Add(it.Current());\n  ReplicadEnsureEdgeMesh')
    text = replace(text, 'ReplicadShapeHashCode(edge, ReplicadShapeHashUpperBound);', 'indexedTopology ? topology.FindIndex(edge) : ReplicadShapeHashCode(edge, ReplicadShapeHashUpperBound);')
    end = '      angularTolerance);\n  }\n};'
    text = replace(text, end, end[:-3] + '''
  static ReplicadEdgeMeshData extractWithTopologyIndices(
    const TopoDS_Shape& shape,
    double tolerance,
    double angularTolerance
  ) {
    return ReplicadExtractEdgeMesh(shape, tolerance, angularTolerance, true);
  }
};''')
    return text

modify("mesh-extractor.cpp", faces)
modify("edge-mesh-extractor.cpp", edges)
modify("custom_build_single.yml", lambda text: replace(text, "  - symbol: Standard_Transient\n", "  - symbol: Standard_Transient\n  - symbol: NCollection_BaseMap\n"), config=True)
prefix = "packages/replicad-opencascadejs/build-config/"
patch = "".join("".join(difflib.unified_diff(before.splitlines(True), after.splitlines(True),
               fromfile="a/" + prefix + name, tofile="b/" + prefix + name))
               for name, (before, after) in changes.items())
(root.parent / "indexed-topology.patch").write_text(patch)
print("Added exact indexed variants; original extractor signatures and math preserved.")
