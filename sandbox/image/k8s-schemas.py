"""
Kubernetes JSON schemas for kubeconform (apps/runner/src/kube.ts), made when the image is
built from the OpenAPI spec of the Kubernetes version the playground runs, so manifests are
checked against the same API the cluster serves, without one.

    python3 k8s-schemas.py swagger.json out/

One file per kind and version, named as kubeconform looks them up ({kind}-{group}-{version}.json,
the group's first word, none for the core group), each pointing into one shared
_definitions.json. Strict: an object's unknown fields are errors (a misspelt "replicas" is
caught), except where Kubernetes keeps unknown fields. Any field may be null, as Kubernetes
allows, and an int-or-string takes either.
"""
import json
import os
import sys


def schema(node):
    """One schema, walked through the places schemas nest; property names are left alone."""
    if not isinstance(node, dict):
        return node
    node = dict(node)
    if isinstance(node.get("properties"), dict):
        node["properties"] = {name: schema(value) for name, value in node["properties"].items()}
    if isinstance(node.get("items"), dict):
        node["items"] = schema(node["items"])
    if isinstance(node.get("additionalProperties"), dict):
        node["additionalProperties"] = schema(node["additionalProperties"])
    for key in ("allOf", "anyOf", "oneOf"):
        if isinstance(node.get(key), list):
            node[key] = [schema(item) for item in node[key]]
    ref = node.get("$ref")
    if isinstance(ref, str) and ref.startswith("#/definitions/"):
        node["$ref"] = "_definitions.json" + ref
    if node.get("format") == "int-or-string":
        node.pop("type", None)
        node["oneOf"] = [{"type": ["string", "null"]}, {"type": ["integer", "null"]}]
    elif isinstance(node.get("type"), str):
        node["type"] = [node["type"], "null"]
    if "properties" in node and "additionalProperties" not in node and not node.get("x-kubernetes-preserve-unknown-fields"):
        node["additionalProperties"] = False
    return node


def main(spec_path, out):
    with open(spec_path) as handle:
        definitions = json.load(handle)["definitions"]
    os.makedirs(out, exist_ok=True)
    with open(os.path.join(out, "_definitions.json"), "w") as handle:
        json.dump({"definitions": {name: schema(value) for name, value in definitions.items()}}, handle)
    count = 0
    for name, definition in definitions.items():
        for gvk in definition.get("x-kubernetes-group-version-kind", []):
            group, version, kind = gvk.get("group", ""), gvk["version"], gvk["kind"]
            suffix = f"-{version}" if not group else f"-{group.split('.')[0]}-{version}"
            with open(os.path.join(out, f"{kind}{suffix}".lower() + ".json"), "w") as handle:
                json.dump({"$ref": f"_definitions.json#/definitions/{name}"}, handle)
            count += 1
    print(f"{count} kinds")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
