const LANGUAGE_BY_EXTENSION = {
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  c: "c",
  js: "javascript",
  jsx: "javascript",
  ts: "typescript",
  tsx: "typescript",
  py: "python",
  java: "java",
  go: "go",
  rs: "rust",
  php: "php",
  rb: "ruby",
  html: "html",
  css: "css",
  json: "json",
  md: "markdown",
};

function generateNodeId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }

  return Math.random().toString(36).slice(2, 12);
}

export function detectLanguageFromName(name = "") {
  const segments = name.split(".");
  const extension = segments.length > 1 ? segments.pop().toLowerCase() : "";
  return LANGUAGE_BY_EXTENSION[extension] || "plaintext";
}

export function createWorkspaceNode({ type, name, content = "", children = [] }) {
  return {
    id: generateNodeId(),
    type,
    name,
    ...(type === "folder" ? { children } : { content }),
  };
}

export function flattenWorkspaceTree(tree, parentPath = "", depth = 0, parentId = null) {
  return tree.flatMap((node) => {
    const path = parentPath ? `${parentPath}/${node.name}` : node.name;
    const entry = {
      node,
      id: node.id,
      name: node.name,
      type: node.type,
      depth,
      path,
      parentId,
    };

    if (node.type === "folder") {
      return [
        entry,
        ...flattenWorkspaceTree(node.children || [], path, depth + 1, node.id),
      ];
    }

    return [entry];
  });
}

export function findNodeById(tree, nodeId) {
  for (const node of tree) {
    if (node.id === nodeId) {
      return node;
    }

    if (node.type === "folder") {
      const nestedNode = findNodeById(node.children || [], nodeId);

      if (nestedNode) {
        return nestedNode;
      }
    }
  }

  return null;
}

export function updateNodeById(tree, nodeId, updater) {
  return tree.map((node) => {
    if (node.id === nodeId) {
      return updater(node);
    }

    if (node.type === "folder") {
      return {
        ...node,
        children: updateNodeById(node.children || [], nodeId, updater),
      };
    }

    return node;
  });
}

export function removeNodeById(tree, nodeId) {
  return tree.reduce((nextTree, node) => {
    if (node.id === nodeId) {
      return nextTree;
    }

    if (node.type === "folder") {
      nextTree.push({
        ...node,
        children: removeNodeById(node.children || [], nodeId),
      });
      return nextTree;
    }

    nextTree.push(node);
    return nextTree;
  }, []);
}

export function addNodeToWorkspace(tree, parentId, newNode) {
  if (!parentId) {
    return [...tree, newNode];
  }

  return tree.map((node) => {
    if (node.id === parentId && node.type === "folder") {
      return {
        ...node,
        children: [...(node.children || []), newNode],
      };
    }

    if (node.type === "folder") {
      return {
        ...node,
        children: addNodeToWorkspace(node.children || [], parentId, newNode),
      };
    }

    return node;
  });
}

export function getFirstFile(tree) {
  const fileEntry = flattenWorkspaceTree(tree).find((entry) => entry.type === "file");
  return fileEntry?.node || null;
}

export function countFiles(tree) {
  return flattenWorkspaceTree(tree).filter((entry) => entry.type === "file").length;
}

export function buildUniqueName(siblings, desiredName) {
  const cleanName = desiredName.trim();

  if (!cleanName) {
    return desiredName;
  }

  const siblingNames = new Set(siblings.map((node) => node.name.toLowerCase()));

  if (!siblingNames.has(cleanName.toLowerCase())) {
    return cleanName;
  }

  const dotIndex = cleanName.lastIndexOf(".");
  const base = dotIndex === -1 ? cleanName : cleanName.slice(0, dotIndex);
  const extension = dotIndex === -1 ? "" : cleanName.slice(dotIndex);
  let counter = 2;

  while (siblingNames.has(`${base}-${counter}${extension}`.toLowerCase())) {
    counter += 1;
  }

  return `${base}-${counter}${extension}`;
}

export function getFolderChildren(tree, folderId) {
  if (!folderId) {
    return tree;
  }

  const folderNode = findNodeById(tree, folderId);

  if (!folderNode || folderNode.type !== "folder") {
    return tree;
  }

  return folderNode.children || [];
}
