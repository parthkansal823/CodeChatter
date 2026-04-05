from __future__ import annotations

import json
import hmac
import logging
import os
import re
import secrets
import time
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from pymongo import ASCENDING, DESCENDING, MongoClient
from pymongo.errors import AutoReconnect, ConnectionFailure, NetworkTimeout, ServerSelectionTimeoutError

logger = logging.getLogger("codechatter.database")

MAX_WORKSPACE_NODES = 500
MAX_WORKSPACE_TOTAL_CONTENT_CHARS = 600_000

DSA_LANGUAGE_OPTIONS: list[dict[str, str]] = [
  {"id": "python", "label": "Python"},
  {"id": "javascript", "label": "JavaScript"},
  {"id": "typescript", "label": "TypeScript"},
  {"id": "cpp", "label": "C++"},
  {"id": "c", "label": "C"},
  {"id": "java", "label": "Java"},
  {"id": "go", "label": "Go"},
  {"id": "rust", "label": "Rust"},
  {"id": "php", "label": "PHP"},
  {"id": "ruby", "label": "Ruby"},
  {"id": "shell", "label": "Shell"},
  {"id": "lua", "label": "Lua"},
  {"id": "perl", "label": "Perl"},
  {"id": "swift", "label": "Swift"},
  {"id": "kotlin", "label": "Kotlin"},
]
DSA_LANGUAGE_IDS = {option["id"] for option in DSA_LANGUAGE_OPTIONS}
ASSIGNABLE_ROOM_ACCESS_ROLES = {"viewer", "editor", "runner", "owner"}


def _node_id() -> str:
  return secrets.token_hex(6)


def _file(name: str, content: str) -> dict[str, Any]:
  return {
    "id": _node_id(),
    "type": "file",
    "name": name,
    "content": content,
  }


def _folder(name: str, children: list[dict[str, Any]] | None = None) -> dict[str, Any]:
  return {
    "id": _node_id(),
    "type": "folder",
    "name": name,
    "children": children or [],
  }



# ------------------------------------------------------------------
# DSA starter snippets per language
# ------------------------------------------------------------------

def _dsa_starter(language: str = "python") -> list:
  lang = (language or "python").lower()

  common = [
    _file(
      "README.md",
      "# DSA Practice\n\n"
      "Use this room for interviews, pair problem-solving, and timed practice.\n\n"
      "Recommended flow:\n"
      "1. Read `problem.md`\n"
      "2. Capture constraints and edge cases in `notes.md`\n"
      "3. Implement the answer in the starter file\n"
      "4. Verify with `test_cases.txt`\n",
    ),
    _file(
      "problem.md",
      "# Problem: Two Sum\n\n"
      "Given an array of integers `nums` and an integer `target`, "
      "return the indices of the two numbers such that they add up to `target`.\n\n"
      "## Example\n\n"
      "- Input: `nums = [2, 7, 11, 15]`, `target = 9`\n"
      "- Output: `[0, 1]`\n\n"
      "## Constraints\n\n"
      "- Exactly one solution exists.\n"
      "- Do not use the same element twice.\n",
    ),
    _file(
      "notes.md",
      "# Notes\n\n"
      "- Brute force: nested loop, O(n^2)\n"
      "- Optimized: hash map, O(n)\n"
      "- Edge cases: duplicates, negative values, short arrays\n"
      "- Explain why each number can only be used once\n",
    ),
    _file(
      "test_cases.txt",
      "nums=[2,7,11,15], target=9 -> [0,1]\n"
      "nums=[3,2,4], target=6 -> [1,2]\n"
      "nums=[3,3], target=6 -> [0,1]\n",
    ),
  ]

  starters = {
    "python": _file(
      "solution.py",
      "def two_sum(nums: list[int], target: int) -> list[int]:\n"
      "    seen: dict[int, int] = {}\n"
      "    for i, v in enumerate(nums):\n"
      "        if target - v in seen:\n"
      "            return [seen[target - v], i]\n"
      "        seen[v] = i\n"
      "    return []\n"
      "\n\n"
      "if __name__ == '__main__':\n"
      "    print(two_sum([2, 7, 11, 15], 9))  # [0, 1]\n",
    ),
    "javascript": _file(
      "solution.js",
      "function twoSum(nums, target) {\n"
      "  const seen = {};\n"
      "  for (let i = 0; i < nums.length; i++) {\n"
      "    const need = target - nums[i];\n"
      "    if (need in seen) return [seen[need], i];\n"
      "    seen[nums[i]] = i;\n"
      "  }\n"
      "  return [];\n"
      "}\n"
      "\n"
      "console.log(twoSum([2, 7, 11, 15], 9)); // [0, 1]\n",
    ),
    "typescript": _file(
      "solution.ts",
      "function twoSum(nums: number[], target: number): number[] {\n"
      "  const seen = new Map<number, number>();\n"
      "  for (let i = 0; i < nums.length; i++) {\n"
      "    const need = target - nums[i];\n"
      "    if (seen.has(need)) return [seen.get(need), i];\n"
      "    seen.set(nums[i], i);\n"
      "  }\n"
      "  return [];\n"
      "}\n"
      "\n"
      "console.log(twoSum([2, 7, 11, 15], 9)); // [0, 1]\n",
    ),
    "cpp": _file(
      "solution.cpp",
      "#include <iostream>\n"
      "#include <unordered_map>\n"
      "#include <vector>\n"
      "using namespace std;\n\n"
      "vector<int> twoSum(const vector<int>& nums, int target) {\n"
      "    unordered_map<int,int> seen;\n"
      "    for (int i = 0; i < (int)nums.size(); i++) {\n"
      "        int need = target - nums[i];\n"
      "        if (seen.count(need)) return {seen[need], i};\n"
      "        seen[nums[i]] = i;\n"
      "    }\n"
      "    return {};\n"
      "}\n\n"
      "int main() {\n"
      "    auto ans = twoSum({2,7,11,15}, 9);\n"
      "    cout << ans[0] << ' ' << ans[1] << '\\n';\n"
      "    return 0;\n"
      "}\n",
    ),
    "java": _file(
      "solution.java",
      "import java.util.HashMap;\n\n"
      "public class solution {\n"
      "    public static int[] twoSum(int[] nums, int target) {\n"
      "        HashMap<Integer,Integer> seen = new HashMap<>();\n"
      "        for (int i = 0; i < nums.length; i++) {\n"
      "            int need = target - nums[i];\n"
      "            if (seen.containsKey(need)) return new int[]{seen.get(need), i};\n"
      "            seen.put(nums[i], i);\n"
      "        }\n"
      "        return new int[]{};\n"
      "    }\n\n"
      "    public static void main(String[] args) {\n"
      "        int[] ans = twoSum(new int[]{2,7,11,15}, 9);\n"
      "        System.out.println(ans[0] + \" \" + ans[1]);\n"
      "    }\n"
      "}\n",
    ),
    "c": _file(
      "solution.c",
      "#include <stdio.h>\n"
      "#include <stdlib.h>\n\n"
      "int* twoSum(int* nums, int numsSize, int target, int* returnSize) {\n"
      "    int* result = (int*)malloc(2 * sizeof(int));\n"
      "    for (int i = 0; i < numsSize; i++) {\n"
      "        for (int j = i + 1; j < numsSize; j++) {\n"
      "            if (nums[i] + nums[j] == target) {\n"
      "                result[0] = i; result[1] = j;\n"
      "                *returnSize = 2;\n"
      "                return result;\n"
      "            }\n"
      "        }\n"
      "    }\n"
      "    *returnSize = 0;\n"
      "    return result;\n"
      "}\n\n"
      "int main() {\n"
      "    int nums[] = {2, 7, 11, 15};\n"
      "    int returnSize;\n"
      "    int* ans = twoSum(nums, 4, 9, &returnSize);\n"
      "    printf(\"%d %d\\n\", ans[0], ans[1]);\n"
      "    free(ans);\n"
      "    return 0;\n"
      "}\n",
    ),
    "go": _file(
      "solution.go",
      "package main\n\n"
      "import \"fmt\"\n\n"
      "func twoSum(nums []int, target int) []int {\n"
      "    seen := map[int]int{}\n"
      "    for i, v := range nums {\n"
      "        if j, ok := seen[target-v]; ok {\n"
      "            return []int{j, i}\n"
      "        }\n"
      "        seen[v] = i\n"
      "    }\n"
      "    return nil\n"
      "}\n\n"
      "func main() {\n"
      "    fmt.Println(twoSum([]int{2, 7, 11, 15}, 9))\n"
      "}\n",
    ),
    "rust": _file(
      "solution.rs",
      "use std::collections::HashMap;\n\n"
      "fn two_sum(nums: Vec<i32>, target: i32) -> Vec<i32> {\n"
      "    let mut seen: HashMap<i32, usize> = HashMap::new();\n"
      "    for (i, &v) in nums.iter().enumerate() {\n"
      "        let need = target - v;\n"
      "        if let Some(&j) = seen.get(&need) {\n"
      "            return vec![j as i32, i as i32];\n"
      "        }\n"
      "        seen.insert(v, i);\n"
      "    }\n"
      "    vec![]\n"
      "}\n\n"
      "fn main() {\n"
      "    println!(\"{:?}\", two_sum(vec![2, 7, 11, 15], 9));\n"
      "}\n",
    ),
    "php": _file(
      "solution.php",
      "<?php\n"
      "function twoSum(array $nums, int $target): array {\n"
      "    $seen = [];\n"
      "    foreach ($nums as $index => $value) {\n"
      "        $need = $target - $value;\n"
      "        if (array_key_exists($need, $seen)) {\n"
      "            return [$seen[$need], $index];\n"
      "        }\n"
      "        $seen[$value] = $index;\n"
      "    }\n"
      "    return [];\n"
      "}\n\n"
      "print_r(twoSum([2, 7, 11, 15], 9));\n",
    ),
    "ruby": _file(
      "solution.rb",
      "def two_sum(nums, target)\n"
      "  seen = {}\n"
      "  nums.each_with_index do |value, index|\n"
      "    need = target - value\n"
      "    return [seen[need], index] if seen.key?(need)\n"
      "    seen[value] = index\n"
      "  end\n"
      "  []\n"
      "end\n\n"
      "p two_sum([2, 7, 11, 15], 9)\n",
    ),
    "shell": _file(
      "solution.sh",
      "#!/usr/bin/env bash\n"
      "nums='2 7 11 15'\n"
      "target=9\n"
      "set -- $nums\n"
      "index_i=0\n\n"
      "for first in \"$@\"; do\n"
      "  index_j=0\n"
      "  for second in \"$@\"; do\n"
      "    if [ \"$index_i\" -lt \"$index_j\" ] && [ $((first + second)) -eq \"$target\" ]; then\n"
      "      echo \"$index_i $index_j\"\n"
      "      exit 0\n"
      "    fi\n"
      "    index_j=$((index_j + 1))\n"
      "  done\n"
      "  index_i=$((index_i + 1))\n"
      "done\n",
    ),
    "lua": _file(
      "solution.lua",
      "local function two_sum(nums, target)\n"
      "  local seen = {}\n"
      "  for index, value in ipairs(nums) do\n"
      "    local need = target - value\n"
      "    if seen[need] ~= nil then\n"
      "      return { seen[need], index - 1 }\n"
      "    end\n"
      "    seen[value] = index - 1\n"
      "  end\n"
      "  return {}\n"
      "end\n\n"
      "local answer = two_sum({2, 7, 11, 15}, 9)\n"
      "print(answer[1], answer[2])\n",
    ),
    "perl": _file(
      "solution.pl",
      "use strict;\n"
      "use warnings;\n\n"
      "sub two_sum {\n"
      "  my ($nums_ref, $target) = @_;\n"
      "  my %seen;\n"
      "  for my $index (0 .. $#$nums_ref) {\n"
      "    my $value = $nums_ref->[$index];\n"
      "    my $need = $target - $value;\n"
      "    return [$seen{$need}, $index] if exists $seen{$need};\n"
      "    $seen{$value} = $index;\n"
      "  }\n"
      "  return [];\n"
      "}\n\n"
      "my $answer = two_sum([2, 7, 11, 15], 9);\n"
      "print join(' ', @$answer), \"\\n\";\n",
    ),
    "swift": _file(
      "solution.swift",
      "import Foundation\n\n"
      "func twoSum(_ nums: [Int], _ target: Int) -> [Int] {\n"
      "    var seen: [Int: Int] = [:]\n"
      "    for (index, value) in nums.enumerated() {\n"
      "        let need = target - value\n"
      "        if let match = seen[need] {\n"
      "            return [match, index]\n"
      "        }\n"
      "        seen[value] = index\n"
      "    }\n"
      "    return []\n"
      "}\n\n"
      "print(twoSum([2, 7, 11, 15], 9))\n",
    ),
    "kotlin": _file(
      "solution.kt",
      "fun twoSum(nums: IntArray, target: Int): IntArray {\n"
      "    val seen = mutableMapOf<Int, Int>()\n"
      "    nums.forEachIndexed { index, value ->\n"
      "        val need = target - value\n"
      "        seen[need]?.let { return intArrayOf(it, index) }\n"
      "        seen[value] = index\n"
      "    }\n"
      "    return intArrayOf()\n"
      "}\n\n"
      "fun main() {\n"
      "    println(twoSum(intArrayOf(2, 7, 11, 15), 9).joinToString(\" \"))\n"
      "}\n",
    ),
  }

  return common + [starters.get(lang, starters["python"])]


ROOM_TEMPLATE_DEFINITIONS: dict[str, dict] = {
  "blank": {
    "id": "blank",
    "name": "Blank Workspace",
    "description": "A clean room with no starter files.",
    "category": "Empty",
    "starterLanguage": "any",
    "featured": True,
    "priority": 10,
    "build": lambda **kw: [],
  },
  "python-starter": {
    "id": "python-starter",
    "name": "Python Sandbox",
    "description": "A tiny Python setup for scripts, notes, and quick experiments.",
    "category": "Backend",
    "starterLanguage": "python",
    "featured": True,
    "priority": 30,
    "build": lambda **kw: [
      _file(
        "main.py",
        "def main() -> None:\n"
        "    message = \"Hello from CodeChatter\"\n"
        "    print(message)\n\n\n"
        "if __name__ == \"__main__\":\n"
        "    main()\n",
      ),
      _file(
        "README.md",
        "# Python Sandbox\n\n"
        "- Keep quick scripts in `main.py`\n"
        "- Add scratch notes beside your code\n"
        "- Run the active file from the room toolbar\n",
      ),
    ],
  },
  "dsa-practice": {
    "id": "dsa-practice",
    "name": "DSA Practice",
    "description": "Problem prompt, notes, test cases, and one language-specific starter file.",
    "category": "Practice",
    "starterLanguage": "python",
    "featured": True,
    "priority": 20,
    "supportedLanguages": deepcopy(DSA_LANGUAGE_OPTIONS),
    "defaultLanguage": "python",
    "build": lambda language="python", **kw: _dsa_starter(language),
  },
  "web-starter": {
    "id": "web-starter",
    "name": "Web Prototype",
    "description": "A simple landing page starter with structure, styles, and one interaction.",
    "category": "Frontend",
    "starterLanguage": "html",
    "featured": True,
    "priority": 40,
    "build": lambda **kw: [
      _file(
        "index.html",
        "<!DOCTYPE html>\n"
        "<html lang=\"en\">\n"
        "  <head>\n"
        "    <meta charset=\"UTF-8\" />\n"
        "    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\" />\n"
        "    <title>CodeChatter Prototype</title>\n"
        "    <link rel=\"stylesheet\" href=\"styles/main.css\" />\n"
        "  </head>\n"
        "  <body>\n"
        "    <main class=\"shell\">\n"
        "      <p class=\"eyebrow\">Collaborative web room</p>\n"
        "      <h1>Ship an idea fast.</h1>\n"
        "      <p class=\"copy\">Start with one page, one script, and a design that is easy to grow together.</p>\n"
        "      <button id=\"hello-button\">Preview interaction</button>\n"
        "    </main>\n"
        "    <script src=\"scripts/main.js\"></script>\n"
        "  </body>\n"
        "</html>\n",
      ),
      _folder("styles", [
        _file(
          "main.css",
          ":root {\n"
          "  color-scheme: light;\n"
          "  --bg: #f6f3ef;\n"
          "  --card: rgba(255, 255, 255, 0.78);\n"
          "  --ink: #18181b;\n"
          "  --muted: #5b5568;\n"
          "  --accent: #0f766e;\n"
          "}\n\n"
          "* { box-sizing: border-box; }\n\n"
          "body {\n"
          "  margin: 0;\n"
          "  min-height: 100vh;\n"
          "  display: grid;\n"
          "  place-items: center;\n"
          "  padding: 24px;\n"
          "  font-family: Georgia, 'Times New Roman', serif;\n"
          "  background:\n"
          "    radial-gradient(circle at top left, rgba(15, 118, 110, 0.18), transparent 32%),\n"
          "    radial-gradient(circle at bottom right, rgba(234, 179, 8, 0.16), transparent 28%),\n"
          "    var(--bg);\n"
          "  color: var(--ink);\n"
          "}\n\n"
          ".shell {\n"
          "  width: min(720px, 100%);\n"
          "  padding: 56px 32px;\n"
          "  border-radius: 28px;\n"
          "  background: var(--card);\n"
          "  backdrop-filter: blur(18px);\n"
          "  box-shadow: 0 28px 90px rgba(24, 24, 27, 0.14);\n"
          "}\n\n"
          ".eyebrow {\n"
          "  margin: 0 0 10px;\n"
          "  font-size: 0.78rem;\n"
          "  letter-spacing: 0.18em;\n"
          "  text-transform: uppercase;\n"
          "  color: var(--accent);\n"
          "}\n\n"
          "h1 {\n"
          "  margin: 0;\n"
          "  font-size: clamp(2.5rem, 5vw, 4.25rem);\n"
          "  line-height: 0.95;\n"
          "}\n\n"
          ".copy {\n"
          "  max-width: 42rem;\n"
          "  margin: 18px 0 0;\n"
          "  font-size: 1.05rem;\n"
          "  line-height: 1.7;\n"
          "  color: var(--muted);\n"
          "}\n\n"
          "button {\n"
          "  margin-top: 28px;\n"
          "  padding: 0.9rem 1.35rem;\n"
          "  border: 0;\n"
          "  border-radius: 999px;\n"
          "  background: var(--ink);\n"
          "  color: white;\n"
          "  cursor: pointer;\n"
          "  font: inherit;\n"
          "}\n",
        ),
      ]),
      _folder("scripts", [
        _file(
          "main.js",
          "const button = document.getElementById(\"hello-button\");\n\n"
          "button?.addEventListener(\"click\", () => {\n"
          "  button.textContent = \"Prototype moving\";\n"
          "  button.disabled = true;\n"
          "  window.setTimeout(() => {\n"
          "    button.textContent = \"Preview interaction\";\n"
          "    button.disabled = false;\n"
          "  }, 1200);\n"
          "});\n",
        ),
      ]),
    ],
  },
  "node-express": {
    "id": "node-express",
    "name": "Node.js Express",
    "description": "A lightweight Express API server with a clean project structure.",
    "category": "Backend",
    "starterLanguage": "javascript",
    "featured": False,
    "priority": 90,
    "build": lambda **kw: [
      _folder("src", [
        _file("index.js", "const express = require('express');\nconst app = express();\n\napp.use(express.json());\n\napp.get('/', (req, res) => {\n  res.json({ message: 'Hello from Express!' });\n});\n\napp.listen(3000, () => {\n  console.log('Server running on http://localhost:3000');\n});\n"),
      ]),
      _file("package.json", "{\n  \"name\": \"express-starter\",\n  \"main\": \"src/index.js\",\n  \"dependencies\": {\n    \"express\": \"^4.18.2\"\n  }\n}\n"),
      _file("README.md", "# Node.js Express Starter\n\nRun `npm install` then `node src/index.js`\n"),
    ],
  },
}


class MongoRepository:
  def __init__(
    self,
    mongo_uri: str,
    database_name: str,
    legacy_data_file: Path | None = None,
  ) -> None:
    self.mongo_uri = mongo_uri
    self.database_name = database_name
    self.legacy_data_file = legacy_data_file
    self._client: MongoClient | Any | None = None
    self._database = None
    self._users = None
    self._rooms = None
    self._otp_challenges = None
    self._is_mock = mongo_uri.startswith("mongomock://")

  def _ping_client(self, client: MongoClient | Any, retries: int = 3) -> None:
    last_error = None

    for attempt in range(1, retries + 1):
      try:
        client.admin.command("ping")
        return
      except (AutoReconnect, ConnectionFailure, NetworkTimeout, ServerSelectionTimeoutError) as error:
        last_error = error
        logger.warning(
          "Mongo ping failed (attempt %s/%s): %s",
          attempt,
          retries,
          error,
        )
        if attempt < retries:
          time.sleep(0.6 * attempt)

    if last_error is not None:
      raise last_error

  def initialize(self) -> None:
    if self._client is not None:
      return

    self._client = self._create_client()

    if not self._is_mock:
      try:
        self._ping_client(self._client)
      except Exception:
        self._client.close()
        self._client = None
        raise

    self._database = self._client[self.database_name]
    self._users = self._database["users"]
    self._rooms = self._database["rooms"]
    self._room_messages = self._database["room_messages"]
    self._otp_challenges = self._database["otp_challenges"]

    self._ensure_indexes()
    self._bootstrap_data()

  def close(self) -> None:
    if self._client is not None:
      self._client.close()
      self._client = None

  def health(self) -> dict[str, Any]:
    self.initialize()

    if not self._is_mock:
      self._ping_client(self._client)

    return {
      "database": self.database_name,
      "engine": "mongomock" if self._is_mock else "mongodb",
    }

  def list_room_templates(self) -> list[dict[str, Any]]:
    featured_templates = sorted(
      (
        template
        for template in ROOM_TEMPLATE_DEFINITIONS.values()
        if template.get("featured", True)
      ),
      key=lambda template: (template.get("priority", 100), template["name"].lower()),
    )

    return [
      {
        "id": template["id"],
        "name": template["name"],
        "description": template["description"],
        "category": template["category"],
        "starterLanguage": template["starterLanguage"],
        "defaultLanguage": template.get("defaultLanguage"),
        "supportedLanguages": deepcopy(template.get("supportedLanguages", [])),
      }
      for template in featured_templates
    ]

  def get_user_by_id(self, user_id: str) -> dict[str, Any] | None:
    self.initialize()
    return self._strip_mongo_id(self._users.find_one({"id": user_id}))

  def get_user_by_email(self, email: str) -> dict[str, Any] | None:
    self.initialize()
    return self._strip_mongo_id(self._users.find_one({"email": email.lower()}))

  def get_user_by_username(self, username: str) -> dict[str, Any] | None:
    self.initialize()
    return self._strip_mongo_id(
      self._users.find_one({"username_lower": username.lower()})
    )

  def create_user(
    self,
    email: str,
    username: str,
    password_hash: str,
    password_salt: str,
  ) -> dict[str, Any]:
    self.initialize()
    timestamp = self._utc_now()
    document = {
      "id": secrets.token_hex(8),
      "email": email.lower(),
      "username": username,
      "username_lower": username.lower(),
      "password_hash": password_hash,
      "password_salt": password_salt,
      "oauth_accounts": {},
      "created_at": timestamp,
      "updated_at": timestamp,
    }
    self._users.insert_one(document)
    return self._strip_mongo_id(document)

  def delete_user_account(self, user_id: str) -> None:
    self.initialize()
    user = self.get_user_by_id(user_id)

    if user is None:
      raise ValueError("User not found")

    self._rooms.delete_many({"owner_id": user_id})
    self._rooms.update_many(
      {"participant_ids": user_id},
      {
        "$pull": {"participant_ids": user_id},
        "$set": {"updated_at": self._utc_now()},
      },
    )
    self._users.delete_one({"id": user_id})

  def store_otp_challenge(
    self,
    mfa_token: str,
    challenge_type: str,
    email: str,
    otp_hash: str,
    expires_at: datetime,
    user_id: str | None = None,
    pending_signup: dict | None = None,
  ) -> None:
    self.initialize()
    self._otp_challenges.insert_one({
      "mfa_token": mfa_token,
      "type": challenge_type,
      "email": email,
      "otp_hash": otp_hash,
      "expires_at": expires_at,
      "attempts": 0,
      "user_id": user_id,
      "pending_signup": pending_signup,
    })

  def get_otp_challenge(self, mfa_token: str) -> dict | None:
    self.initialize()
    return self._strip_mongo_id(
      self._otp_challenges.find_one({"mfa_token": mfa_token})
    )

  def increment_otp_attempts(self, mfa_token: str) -> int:
    from pymongo import ReturnDocument
    self.initialize()
    result = self._otp_challenges.find_one_and_update(
      {"mfa_token": mfa_token},
      {"$inc": {"attempts": 1}},
      return_document=ReturnDocument.AFTER,
    )
    return result["attempts"] if result else 0

  def update_otp_challenge(self, mfa_token: str, otp_hash: str, expires_at: datetime) -> None:
    self.initialize()
    self._otp_challenges.update_one(
      {"mfa_token": mfa_token},
      {"$set": {"otp_hash": otp_hash, "expires_at": expires_at, "attempts": 0}},
    )

  def delete_otp_challenge(self, mfa_token: str) -> None:
    self.initialize()
    self._otp_challenges.delete_one({"mfa_token": mfa_token})

  def upsert_oauth_user(
    self,
    provider: str,
    provider_user_id: str,
    email: str,
    preferred_username: str,
    access_token: str | None = None,
    provider_username: str | None = None,
    provider_avatar_url: str | None = None,
  ) -> dict[str, Any]:
    self.initialize()

    provider_key = f"oauth_accounts.{provider}"
    existing_by_provider = self._strip_mongo_id(
      self._users.find_one({provider_key: provider_user_id})
    )

    extra: dict[str, Any] = {"updated_at": self._utc_now()}
    if access_token:
      extra[f"oauth_tokens.{provider}"] = access_token
    if provider_username:
      extra[f"oauth_usernames.{provider}"] = provider_username
    if provider_avatar_url:
      extra[f"oauth_avatars.{provider}"] = provider_avatar_url

    if existing_by_provider is not None:
      updates: dict[str, Any] = {"email": email.lower(), **extra}
      if not existing_by_provider.get("username"):
        unique_username = self.build_unique_username(preferred_username)
        updates["username"] = unique_username
        updates["username_lower"] = unique_username.lower()
      self._users.update_one({"id": existing_by_provider["id"]}, {"$set": updates})
      return self.get_user_by_id(existing_by_provider["id"])

    existing_by_email = self.get_user_by_email(email)

    if existing_by_email is not None:
      self._users.update_one(
        {"id": existing_by_email["id"]},
        {
          "$set": {
            provider_key: provider_user_id,
            **extra,
          }
        },
      )
      return self.get_user_by_id(existing_by_email["id"])

    timestamp = self._utc_now()
    unique_username = self.build_unique_username(preferred_username)
    document: dict[str, Any] = {
      "id": secrets.token_hex(8),
      "email": email.lower(),
      "username": unique_username,
      "username_lower": unique_username.lower(),
      "password_hash": "",
      "password_salt": "",
      "oauth_accounts": {provider: provider_user_id},
      "oauth_tokens": {},
      "oauth_usernames": {},
      "oauth_avatars": {},
      "created_at": timestamp,
      "updated_at": timestamp,
    }
    if access_token:
      document["oauth_tokens"][provider] = access_token
    if provider_username:
      document["oauth_usernames"][provider] = provider_username
    if provider_avatar_url:
      document["oauth_avatars"][provider] = provider_avatar_url
    self._users.insert_one(document)
    return self._strip_mongo_id(document)

  def connect_oauth_to_user(
    self,
    user_id: str,
    provider: str,
    provider_user_id: str,
    access_token: str | None = None,
    provider_username: str | None = None,
    provider_avatar_url: str | None = None,
  ) -> dict[str, Any]:
    """Link an OAuth provider to an existing authenticated account."""
    self.initialize()
    provider_key = f"oauth_accounts.{provider}"

    # Ensure this provider ID isn't already linked to another account
    existing = self._strip_mongo_id(self._users.find_one({provider_key: provider_user_id}))
    if existing and existing["id"] != user_id:
      raise ValueError(f"This {provider} account is already linked to another user")

    updates: dict[str, Any] = {
      provider_key: provider_user_id,
      "updated_at": self._utc_now(),
    }
    if access_token:
      updates[f"oauth_tokens.{provider}"] = access_token
    if provider_username:
      updates[f"oauth_usernames.{provider}"] = provider_username
    if provider_avatar_url:
      updates[f"oauth_avatars.{provider}"] = provider_avatar_url

    self._users.update_one({"id": user_id}, {"$set": updates})
    return self.get_user_by_id(user_id)

  def disconnect_oauth_from_user(self, user_id: str, provider: str) -> dict[str, Any]:
    """Unlink an OAuth provider from a user account."""
    self.initialize()
    self._users.update_one(
      {"id": user_id},
      {
        "$unset": {
          f"oauth_accounts.{provider}": "",
          f"oauth_tokens.{provider}": "",
          f"oauth_usernames.{provider}": "",
          f"oauth_avatars.{provider}": "",
        },
        "$set": {"updated_at": self._utc_now()},
      },
    )
    return self.get_user_by_id(user_id)

  def get_oauth_token(self, user_id: str, provider: str) -> str | None:
    """Return the stored OAuth access token for a provider."""
    self.initialize()
    user = self._users.find_one({"id": user_id}, {f"oauth_tokens.{provider}": 1})
    if not user:
      return None
    return (user.get("oauth_tokens") or {}).get(provider)

  # ── GitHub room link ─────────────────────────────────────────────────────

  def set_room_github_link(self, room_id: str, user_id: str, link_data: dict) -> bool:
    """Store a github_link on a room. Only owners may set this."""
    self.initialize()
    owner_filter = {"id": room_id, "$or": [{"owner_id": user_id}, {"owner_ids": user_id}]}
    result = self._rooms.update_one(
      owner_filter,
      {"$set": {"github_link": link_data, "updated_at": self._utc_now()}},
    )
    return result.matched_count > 0

  def clear_room_github_link(self, room_id: str, user_id: str) -> bool:
    """Remove the github_link from a room. Only owners may do this."""
    self.initialize()
    owner_filter = {"id": room_id, "$or": [{"owner_id": user_id}, {"owner_ids": user_id}]}
    result = self._rooms.update_one(
      owner_filter,
      {"$unset": {"github_link": ""}, "$set": {"updated_at": self._utc_now()}},
    )
    return result.matched_count > 0

  def get_room_github_link(self, room_id: str) -> dict | None:
    """Return the github_link dict for a room, or None."""
    self.initialize()
    doc = self._rooms.find_one({"id": room_id}, {"github_link": 1})
    return (doc or {}).get("github_link")

  def set_room_workspace_tree_raw(self, room_id: str, tree: list) -> None:
    """Directly write workspace tree — no permission check (caller must verify)."""
    self.initialize()
    self._rooms.update_one(
      {"id": room_id},
      {"$set": {"workspace_tree": tree, "updated_at": self._utc_now()}},
    )

  def create_room(
    self,
    owner_id: str,
    name: str | None,
    description: str | None,
    is_public: bool,
    template_id: str | None = None,
    terminal_shell: str | None = None,
    dsa_language: str | None = None,
    require_join_approval: bool | None = None,
  ) -> dict[str, Any]:
    self.initialize()
    selected_template_id = template_id or "blank"
    template_definition = ROOM_TEMPLATE_DEFINITIONS.get(selected_template_id)

    if template_definition is None:
      raise ValueError("Unknown room template")

    room_id = self.generate_room_id()
    timestamp = self._utc_now()
    document = {
      "id": room_id,
      "name": name or f"{template_definition['name']} Room",
      "description": description or template_definition["description"],
      "is_public": is_public,
      "require_join_approval": require_join_approval if require_join_approval is not None else False,
      "invite_token": self.generate_invite_token(),
      "owner_id": owner_id,
      "owner_ids": [owner_id],
      "participant_ids": [owner_id],
      "template_id": selected_template_id,
      "terminal_shell": terminal_shell or ("powershell" if os.name == "nt" else "bash"),
      "workspace_tree": self.build_workspace_from_template(selected_template_id, dsa_language=dsa_language or "python"),
      "created_at": timestamp,
      "updated_at": timestamp,
    }
    self._rooms.insert_one(document)
    return self.serialize_room(document, include_workspace=True, viewer_user_id=owner_id)

  def get_room_by_id(self, room_id: str) -> dict[str, Any] | None:
    self.initialize()
    return self._strip_mongo_id(self._rooms.find_one({"id": room_id}))

  def get_room_for_user(self, user_id: str, room_id: str) -> dict[str, Any] | None:
    self.initialize()
    room = self.get_room_by_id(room_id)

    if room is None:
      return None

    if not self.user_can_access_room(user_id, room):
      return None

    return self.serialize_room(room, include_workspace=True, viewer_user_id=user_id)

  def join_room(
    self,
    user_id: str,
    room_id: str,
    invite_token: str | None = None,
  ) -> dict[str, Any]:
    self.initialize()
    user = self.get_user_by_id(user_id)
    room = self._strip_mongo_id(self._rooms.find_one({"id": room_id}))

    if room is None:
      raise ValueError("Room not found")

    # Already a participant or owner — just return the room
    if user_id in self._get_owner_ids(room) or user_id in room.get("participant_ids", []):
      return self.serialize_room(room, include_workspace=True, viewer_user_id=user_id)

    room_is_public = bool(room.get("is_public", False))
    expected_invite_token = str(room.get("invite_token", "")).strip()
    has_valid_invite = bool(invite_token) and expected_invite_token and hmac.compare_digest(
      expected_invite_token,
      invite_token,
    )

    if not room_is_public and not has_valid_invite:
      raise PermissionError("This room is private. Join with a valid invite link.")

    # Check if a pending join request already exists for this user
    existing_requests = room.get("join_requests", [])
    existing = next((r for r in existing_requests if r.get("user_id") == user_id and r.get("status") == "pending"), None)
    if existing:
      return {
        "status": "pending_approval",
        "roomName": room.get("name"),
        "accessRole": existing.get("access_role", "editor"),
        "requestedAt": existing.get("requested_at").isoformat() if isinstance(existing.get("requested_at"), datetime) else existing.get("requested_at"),
        "message": "You already have a pending join request. The owner will let you in soon.",
      }

    # Public rooms without approval requirement → direct join
    if room_is_public and not room.get("require_join_approval", False):
      timestamp = self._utc_now()
      self._rooms.update_one(
        {"id": room_id},
        {
          "$addToSet": {"participant_ids": user_id},
            "$set": {"updated_at": timestamp},
        },
      )
      updated_room = self._strip_mongo_id(self._rooms.find_one({"id": room_id}))
      return self.serialize_room(updated_room, include_workspace=True, viewer_user_id=user_id)

    # Invite link without approval requirement → direct join
    if has_valid_invite and not room.get("require_join_approval", False):
      timestamp = self._utc_now()
      self._rooms.update_one(
        {"id": room_id},
        {
          "$addToSet": {"participant_ids": user_id},
            "$set": {"updated_at": timestamp},
        },
      )
      updated_room = self._strip_mongo_id(self._rooms.find_one({"id": room_id}))
      return self.serialize_room(updated_room, include_workspace=True, viewer_user_id=user_id)

    # Approval required → create a pending join request
    timestamp = self._utc_now()
    join_request = {
      "id": secrets.token_hex(8),
      "user_id": user_id,
      "username": user.get("username", "") if user else "",
      "email": user.get("email", "") if user else "",
      "access_role": "editor",
      "status": "pending",
      "requested_at": timestamp,
    }
    self._rooms.update_one(
      {"id": room_id},
      {
        "$push": {"join_requests": join_request},
        "$set": {"updated_at": timestamp},
      },
    )
    return {
      "status": "pending_approval",
      "roomName": room.get("name"),
      "accessRole": "editor",
      "requestedAt": timestamp.isoformat(),
      "message": "Your join request has been sent. The owner will review it shortly.",
    }

  def get_room_join_status(self, user_id: str, room_id: str) -> dict[str, Any]:
    self.initialize()
    room = self._strip_mongo_id(self._rooms.find_one({"id": room_id}))

    if room is None:
      raise ValueError("Room not found")

    # Owner
    if user_id in self._get_owner_ids(room):
      return {"status": "approved", "accessRole": "owner"}

    # Already a participant
    if user_id in room.get("participant_ids", []):
      member_roles = room.get("member_access_roles", {})
      role = member_roles.get(user_id, "editor")
      return {"status": "approved", "accessRole": role}

    # Check pending/rejected join requests
    join_requests = room.get("join_requests", [])
    user_request = next(
      (r for r in reversed(join_requests) if r.get("user_id") == user_id),
      None,
    )

    if user_request:
      status = user_request.get("status", "pending")
      requested_at = user_request.get("requested_at")
      return {
        "status": "pending_approval" if status == "pending" else "rejected",
        "roomName": room.get("name"),
        "accessRole": user_request.get("access_role", "editor"),
        "requestedAt": requested_at.isoformat() if isinstance(requested_at, datetime) else requested_at,
        "message": (
          "Your join request is waiting for approval."
          if status == "pending"
          else "Your join request was rejected. Contact the owner for a fresh invite."
        ),
      }

    return {"status": "not_requested"}

  def approve_room_join_request(
    self,
    owner_id: str,
    room_id: str,
    request_id: str,
    access_role: str = "editor",
  ) -> dict[str, Any]:
    self.initialize()
    room = self._strip_mongo_id(self._rooms.find_one({"id": room_id}))

    if room is None:
      raise ValueError("Room not found")

    if owner_id not in self._get_owner_ids(room):
      raise PermissionError("Only a room owner can approve join requests")

    join_requests = room.get("join_requests", [])
    request = next((r for r in join_requests if r.get("id") == request_id), None)

    if request is None:
      raise ValueError("Join request not found")

    user_id = request["user_id"]
    timestamp = self._utc_now()

    # Mark request approved and add user to participants
    if access_role == "owner":
      self._rooms.update_one(
        {"id": room_id, "join_requests.id": request_id},
        {
          "$set": {
            "join_requests.$.status": "approved",
            "updated_at": timestamp,
          },
          "$addToSet": {
            "participant_ids": user_id,
            "owner_ids": user_id,
          },
          "$unset": {f"member_access_roles.{user_id}": ""},
        },
      )
    else:
      self._rooms.update_one(
        {"id": room_id, "join_requests.id": request_id},
        {
          "$set": {
            "join_requests.$.status": "approved",
            f"member_access_roles.{user_id}": access_role,
            "updated_at": timestamp,
          },
          "$addToSet": {"participant_ids": user_id},
        },
      )

    updated_room = self._strip_mongo_id(self._rooms.find_one({"id": room_id}))
    return self.serialize_room(updated_room, include_workspace=False, viewer_user_id=owner_id)

  def reject_room_join_request(
    self,
    owner_id: str,
    room_id: str,
    request_id: str,
  ) -> dict[str, Any]:
    self.initialize()
    room = self._strip_mongo_id(self._rooms.find_one({"id": room_id}))

    if room is None:
      raise ValueError("Room not found")

    if owner_id not in self._get_owner_ids(room):
      raise PermissionError("Only a room owner can reject join requests")

    timestamp = self._utc_now()
    self._rooms.update_one(
      {"id": room_id, "join_requests.id": request_id},
      {
        "$set": {
          "join_requests.$.status": "rejected",
          "updated_at": timestamp,
        }
      },
    )

    updated_room = self._strip_mongo_id(self._rooms.find_one({"id": room_id}))
    return self.serialize_room(updated_room, include_workspace=False, viewer_user_id=owner_id)

  def update_room_member_access(
    self,
    owner_id: str,
    room_id: str,
    member_id: str,
    access_role: str,
  ) -> dict[str, Any]:
    self.initialize()
    room = self._strip_mongo_id(self._rooms.find_one({"id": room_id}))

    if room is None:
      raise ValueError("Room not found")

    current_owner_ids = self._get_owner_ids(room)
    if owner_id not in current_owner_ids:
      raise PermissionError("Only a room owner can change member access")

    if member_id not in room.get("participant_ids", []):
      raise ValueError("User is not a member of this room")

    # Prevent an owner from stripping themselves of owner status if they are the last owner
    if member_id in current_owner_ids and access_role != "owner":
      if len(current_owner_ids) <= 1:
        raise PermissionError("Cannot demote the last owner of a room")

    timestamp = self._utc_now()

    if access_role == "owner":
      # Promote: add to owner_ids, remove from member_access_roles
      self._rooms.update_one(
        {"id": room_id},
        {
          "$addToSet": {"owner_ids": member_id},
          "$unset": {f"member_access_roles.{member_id}": ""},
          "$set": {"updated_at": timestamp},
        },
      )
    elif member_id in current_owner_ids:
      # Demote owner to another role
      self._rooms.update_one(
        {"id": room_id},
        {
          "$pull": {"owner_ids": member_id},
          "$set": {
            f"member_access_roles.{member_id}": access_role,
            "updated_at": timestamp,
          },
        },
      )
    else:
      self._rooms.update_one(
        {"id": room_id},
        {
          "$set": {
            f"member_access_roles.{member_id}": access_role,
            "updated_at": timestamp,
          }
        },
      )

    updated_room = self._strip_mongo_id(self._rooms.find_one({"id": room_id}))
    return self.serialize_room(updated_room, include_workspace=False, viewer_user_id=owner_id)



  def delete_room(self, user_id: str, room_id: str) -> None:
    self.initialize()
    room = self.get_room_by_id(room_id)

    if room is None:
      raise ValueError("Room not found")

    if user_id not in self._get_owner_ids(room):
      raise PermissionError("Only a room owner can delete this room")

    self._rooms.delete_one({"id": room_id})

  def update_room_workspace(
    self,
    user_id: str,
    room_id: str,
    workspace_tree: list[dict[str, Any]],
  ) -> dict[str, Any]:
    self.initialize()
    room = self.get_room_by_id(room_id)

    if room is None:
      raise ValueError("Room not found")

    if not self.user_can_edit_room(user_id, room):
      raise PermissionError("You do not have permission to update the workspace")

    normalized_tree = self.normalize_workspace_tree(workspace_tree)
    timestamp = self._utc_now()
    self._rooms.update_one(
      {"id": room_id},
      {
        "$set": {
          "workspace_tree": normalized_tree,
          "updated_at": timestamp,
        }
      },
    )

    updated_room = self._strip_mongo_id(self._rooms.find_one({"id": room_id}))
    return self.serialize_room(updated_room, include_workspace=True, viewer_user_id=user_id)

  def update_room_settings(
    self,
    user_id: str,
    room_id: str,
    name: str | None = None,
    description: str | None = None,
    terminal_shell: str | None = None,
    require_join_approval: bool | None = None,
  ) -> dict[str, Any]:
    self.initialize()
    room = self.get_room_by_id(room_id)

    if room is None:
      raise ValueError("Room not found")

    if user_id not in self._get_owner_ids(room):
      raise PermissionError("Only a room owner can update room settings")

    updates = {"updated_at": self._utc_now()}
    if name is not None:
      updates["name"] = name
    if description is not None:
      updates["description"] = description
    if terminal_shell is not None:
      updates["terminal_shell"] = terminal_shell
    if require_join_approval is not None:
      updates["require_join_approval"] = require_join_approval

    self._rooms.update_one({"id": room_id}, {"$set": updates})

    updated_room = self._strip_mongo_id(self._rooms.find_one({"id": room_id}))
    return self.serialize_room(updated_room, include_workspace=True, viewer_user_id=user_id)

  def touch_room(self, room_id: str) -> None:
    self.initialize()
    self._rooms.update_one(
      {"id": room_id},
      {
        "$set": {
          "updated_at": self._utc_now(),
        }
      },
    )

  def list_user_rooms(self, user_id: str) -> list[dict[str, Any]]:
    self.initialize()
    rooms = [
      self._strip_mongo_id(room)
      for room in self._rooms.find(
        {
          "$or": [
            {"owner_id": user_id},
            {"owner_ids": user_id},
            {"participant_ids": user_id},
          ]
        }
      ).sort("updated_at", DESCENDING)
    ]
    return [self.serialize_room(room, viewer_user_id=user_id) for room in rooms]

  def list_public_rooms(self) -> list[dict[str, Any]]:
    self.initialize()
    rooms = [
      self._strip_mongo_id(room)
      for room in self._rooms.find({"is_public": True}).sort("updated_at", DESCENDING)
    ]
    serialized_rooms = [self.serialize_room(room) for room in rooms]
    serialized_rooms.sort(
      key=lambda room: (room["participantCount"], room["updatedAt"] or ""),
      reverse=True,
    )
    return serialized_rooms

  def list_collaborators(self, user_id: str) -> list[dict[str, Any]]:
    self.initialize()
    rooms = list(
      self._rooms.find(
        {
          "$or": [
            {"owner_id": user_id},
            {"owner_ids": user_id},
            {"participant_ids": user_id},
          ]
        },
        {"participant_ids": 1},
      )
    )

    collaborator_ids = {
      participant_id
      for room in rooms
      for participant_id in room.get("participant_ids", [])
      if participant_id != user_id
    }

    if not collaborator_ids:
      return []

    collaborators = [
      self.serialize_collaborator(self._strip_mongo_id(user))
      for user in self._users.find({"id": {"$in": list(collaborator_ids)}})
    ]
    collaborators.sort(key=lambda collaborator: collaborator["username"].lower())
    return collaborators

  def build_unique_username(self, preferred_username: str) -> str:
    self.initialize()

    base_username = re.sub(r"[^a-zA-Z0-9_-]", "", preferred_username)[:32] or "developer"
    candidate = base_username
    suffix = 1

    while self._users.find_one({"username_lower": candidate.lower()}):
      suffix_text = str(suffix)
      candidate = f"{base_username[: max(1, 32 - len(suffix_text))]}{suffix_text}"
      suffix += 1

    return candidate

  def generate_room_id(self) -> str:
    self.initialize()

    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

    while True:
      candidate = "".join(secrets.choice(alphabet) for _ in range(6))
      if self._rooms.find_one({"id": candidate}) is None:
        return candidate

  @staticmethod
  def generate_invite_token() -> str:
    return secrets.token_urlsafe(18)

  def build_workspace_from_template(self, template_id: str, dsa_language: str = "python") -> list[dict[str, Any]]:
    template_definition = ROOM_TEMPLATE_DEFINITIONS.get(template_id or "blank")

    if template_definition is None:
      return []

    return deepcopy(template_definition["build"](language=dsa_language))

  def _get_owner_ids(self, room: dict[str, Any]) -> list[str]:
    """Return the list of owner user-IDs, supporting legacy single-owner rooms."""
    owner_ids = room.get("owner_ids")
    if owner_ids:
      return list(owner_ids)
    oid = room.get("owner_id")
    return [oid] if oid else []

  def user_can_access_room(self, user_id: str, room: dict[str, Any]) -> bool:
    return (
      user_id in self._get_owner_ids(room)
      or user_id in room.get("participant_ids", [])
      or bool(room.get("is_public", False))
    )

  def user_can_edit_room(self, user_id: str, room: dict[str, Any]) -> bool:
    """owner + editor role can edit files."""
    if user_id in self._get_owner_ids(room):
      return True
    if user_id in room.get("participant_ids", []):
      member_roles = room.get("member_access_roles", {})
      return member_roles.get(user_id, "editor") == "editor"
    return False

  def user_can_run_room(self, user_id: str, room: dict[str, Any]) -> bool:
    """owner + editor + runner can execute code."""
    if user_id in self._get_owner_ids(room):
      return True
    if user_id in room.get("participant_ids", []):
      member_roles = room.get("member_access_roles", {})
      return member_roles.get(user_id, "editor") in ("editor", "runner")
    return False

  def _get_viewer_role(self, user_id: str, room: dict[str, Any]) -> str:
    """Return the effective access role string for a viewer."""
    if user_id in self._get_owner_ids(room):
      return "owner"
    if user_id in room.get("participant_ids", []):
      member_roles = room.get("member_access_roles", {})
      return member_roles.get(user_id, "editor")
    return "viewer"

  def serialize_user(self, user: dict[str, Any]) -> dict[str, Any]:
    oauth_accounts = user.get("oauth_accounts") or {}
    oauth_usernames = user.get("oauth_usernames") or {}
    oauth_avatars = user.get("oauth_avatars") or {}
    return {
      "id": user["id"],
      "email": user["email"],
      "username": user["username"],
      "githubConnected": bool(oauth_accounts.get("github")),
      "githubUsername": oauth_usernames.get("github") or None,
      "githubAvatarUrl": oauth_avatars.get("github") or None,
      "googleConnected": bool(oauth_accounts.get("google")),
      "hasPassword": bool(user.get("password_hash")),
    }

  def serialize_collaborator(self, user: dict[str, Any], access_role: str = "editor") -> dict[str, Any]:
    return {
      **self.serialize_user(user),
      "active": True,
      "accessRole": access_role,
    }

  def serialize_room(
    self,
    room: dict[str, Any],
    include_workspace: bool = False,
    viewer_user_id: str | None = None,
  ) -> dict[str, Any]:
    participant_ids = room.get("participant_ids", [])
    owner_id = room.get("owner_id")
    owner_ids = self._get_owner_ids(room)
    member_roles: dict[str, str] = room.get("member_access_roles") or {}

    if participant_ids:
      users = list(self._users.find({"id": {"$in": participant_ids}}))
      users_by_id = {
        user["id"]: self._strip_mongo_id(user)
        for user in users
      }
    else:
      users_by_id = {}

    collaborators = [
      self.serialize_collaborator(
        users_by_id[pid],
        access_role="owner" if pid in owner_ids else member_roles.get(pid, "editor"),
      )
      for pid in participant_ids
      if pid in users_by_id
    ]

    updated_at = room.get("updated_at")
    updated_at_iso = updated_at.isoformat() if isinstance(updated_at, datetime) else updated_at
    template_id = room.get("template_id") or "blank"
    template_definition = ROOM_TEMPLATE_DEFINITIONS.get(template_id, ROOM_TEMPLATE_DEFINITIONS["blank"])
    workspace_tree = room.get("workspace_tree", [])

    # — Compute per-viewer permission flags —
    viewer_role = self._get_viewer_role(viewer_user_id, room) if viewer_user_id else "viewer"
    is_owner = viewer_role == "owner"
    is_editor = viewer_role == "editor"
    is_runner = viewer_role == "runner"
    # owner: full access | editor: edit+run | runner: run only | viewer: read only
    can_edit = is_owner or is_editor
    can_run = is_owner or is_editor or is_runner
    can_manage = is_owner
    can_use_terminal = is_owner or is_editor or is_runner

    # — Pending join requests (admin only) —
    all_requests = room.get("join_requests") or []
    pending_requests = []
    if is_owner:
      for req in all_requests:
        if req.get("status") == "pending":
          req_time = req.get("requested_at")
          pending_requests.append({
            "id": req.get("id"),
            "userId": req.get("user_id"),
            "username": req.get("username", ""),
            "email": req.get("email", ""),
            "accessRole": req.get("access_role", "editor"),
            "requestedAt": req_time.isoformat() if isinstance(req_time, datetime) else req_time,
          })

    serialized_room = {
      "id": room["id"],
      "name": room.get("name") or f"Room {room['id']}",
      "description": room.get("description", ""),
      "participantCount": len(collaborators),
      "collaborators": collaborators,
      "isPublic": room.get("is_public", False),
      "requireJoinApproval": room.get("require_join_approval", False),
      "updatedAt": updated_at_iso,
      "ownerId": owner_id,
      "ownerIds": owner_ids,
      "templateId": template_id,
      "templateName": template_definition["name"],
      "terminalShell": room.get("terminal_shell") or ("powershell" if os.name == "nt" else "bash"),
      "fileCount": self.count_workspace_files(workspace_tree),
      # Permission flags for the current viewer
      "accessRole": viewer_role,
      "canEdit": can_edit,
      "canRun": can_run,
      "canManage": can_manage,
      "canUseTerminal": can_use_terminal,
      # Admin-only fields
      "pendingJoinRequests": pending_requests,
      "pendingJoinRequestCount": len(pending_requests),
    }

    if viewer_user_id and (
      viewer_user_id in owner_ids
      or viewer_user_id in participant_ids
    ):
      serialized_room["inviteToken"] = str(room.get("invite_token", "")).strip()

    if include_workspace:
      serialized_room["workspaceTree"] = deepcopy(workspace_tree)

    return serialized_room

  def normalize_workspace_tree(
    self,
    nodes: list[dict[str, Any]],
    depth: int = 0,
    stats: dict[str, int] | None = None,
  ) -> list[dict[str, Any]]:
    if stats is None:
      stats = {"nodes": 0, "characters": 0}

    if depth > 12:
      raise ValueError("Workspace nesting is too deep")

    normalized_nodes: list[dict[str, Any]] = []
    sibling_names: set[str] = set()

    for raw_node in nodes:
      node_type = str(raw_node.get("type", "")).strip().lower()
      node_name = self._normalize_node_name(raw_node.get("name"))

      if not node_name:
        continue

      node_name = self._build_unique_node_name(sibling_names, node_name)
      stats["nodes"] += 1

      if stats["nodes"] > MAX_WORKSPACE_NODES:
        raise ValueError("Workspace is too large")

      if node_type == "folder":
        normalized_nodes.append(
          {
            "id": str(raw_node.get("id") or _node_id()),
            "type": "folder",
            "name": node_name,
            "children": self.normalize_workspace_tree(
              list(raw_node.get("children", [])) if isinstance(raw_node.get("children", []), list) else [],
              depth + 1,
              stats,
            ),
          }
        )
        continue

      if node_type == "file":
        content = str(raw_node.get("content", ""))[:250_000]
        stats["characters"] += len(content)

        if stats["characters"] > MAX_WORKSPACE_TOTAL_CONTENT_CHARS:
          raise ValueError("Workspace content is too large")

        file_node: dict[str, Any] = {
          "id": str(raw_node.get("id") or _node_id()),
          "type": "file",
          "name": node_name,
          "content": content,
        }
        # Preserve GitHub sync metadata if present
        if raw_node.get("githubPath"):
          file_node["githubPath"] = str(raw_node["githubPath"])[:500]
        if raw_node.get("githubSha"):
          file_node["githubSha"] = str(raw_node["githubSha"])[:64]
        normalized_nodes.append(file_node)

    return normalized_nodes

  def count_workspace_files(self, nodes: list[dict[str, Any]]) -> int:
    count = 0

    for node in nodes:
      if node.get("type") == "file":
        count += 1
      elif node.get("type") == "folder":
        count += self.count_workspace_files(node.get("children", []))

    return count

  def insert_room_message(self, room_id: str, message: dict[str, Any]) -> dict[str, Any]:
    self.initialize()
    timestamp = self._utc_now()
    document = {
      "id": message.get("id") or secrets.token_hex(16),
      "room_id": room_id,
      "userId": message.get("userId"),
      "sender": message.get("sender"),
      "text": message.get("text", ""),
      "msgType": message.get("msgType") or message.get("type", "text"),
      "fileUrl": message.get("fileUrl"),
      "fileName": message.get("fileName"),
      "fileSize": message.get("fileSize"),
      "created_at": timestamp,
    }
    self._room_messages.insert_one(document)
    result = self._strip_mongo_id(document)
    if isinstance(result.get("created_at"), datetime):
      result["time"] = result["created_at"].strftime("%I:%M %p")
      result["created_at"] = result["created_at"].isoformat()
    return result

  def get_room_messages(self, room_id: str, limit: int = 200) -> list[dict[str, Any]]:
    self.initialize()
    cursor = self._room_messages.find({"room_id": room_id}).sort("created_at", ASCENDING).limit(limit)
    messages = [self._strip_mongo_id(msg) for msg in cursor]
    for msg in messages:
      if isinstance(msg.get("created_at"), datetime):
        msg["time"] = msg["created_at"].strftime("%I:%M %p")
        msg["created_at"] = msg["created_at"].isoformat()
    return messages

  def _create_client(self):
    if self._is_mock:
      import mongomock

      return mongomock.MongoClient(tz_aware=True)

    return MongoClient(
      self.mongo_uri,
      appname="CodeChatter",
      serverSelectionTimeoutMS=8000,
      connectTimeoutMS=10000,
      socketTimeoutMS=15000,
      heartbeatFrequencyMS=10000,
      maxIdleTimeMS=60000,
      maxPoolSize=30,
      minPoolSize=1,
      retryWrites=True,
      retryReads=True,
      tz_aware=True,
    )

  def _ensure_indexes(self) -> None:
    self._users.create_index([("id", ASCENDING)], unique=True)
    self._users.create_index([("email", ASCENDING)], unique=True)
    self._users.create_index([("username_lower", ASCENDING)], unique=True)
    self._users.create_index([("oauth_accounts.google", ASCENDING)], unique=True, sparse=True)
    self._users.create_index([("oauth_accounts.github", ASCENDING)], unique=True, sparse=True)

    self._rooms.create_index([("id", ASCENDING)], unique=True)
    self._rooms.create_index([("owner_id", ASCENDING), ("updated_at", DESCENDING)])
    self._rooms.create_index([("participant_ids", ASCENDING)])
    self._rooms.create_index([("join_requests.user_id", ASCENDING)])
    self._rooms.create_index([("is_public", ASCENDING), ("updated_at", DESCENDING)])

    self._room_messages.create_index([("id", ASCENDING)], unique=True)
    self._room_messages.create_index([("room_id", ASCENDING), ("created_at", ASCENDING)])

    self._otp_challenges.create_index([("mfa_token", ASCENDING)], unique=True)
    self._otp_challenges.create_index([("expires_at", ASCENDING)], expireAfterSeconds=0)

  def _bootstrap_data(self) -> None:
    has_users = self._users.count_documents({}) > 0
    has_rooms = self._rooms.count_documents({}) > 0

    if not has_users and not has_rooms and self.legacy_data_file and self.legacy_data_file.exists():
      self._migrate_legacy_data()
      has_users = self._users.count_documents({}) > 0
      has_rooms = self._rooms.count_documents({}) > 0

    if not has_rooms:
      self._seed_public_rooms()

    self._repair_seeded_rooms()

  def _migrate_legacy_data(self) -> None:
    try:
      raw_data = json.loads(self.legacy_data_file.read_text(encoding="utf-8"))
    except Exception as error:
      logger.warning("Could not load legacy JSON data for migration: %s", error)
      return

    users = []

    for user in raw_data.get("users", []):
      username = user.get("username") or self.build_unique_username("developer")
      users.append(
        {
          "id": user.get("id") or secrets.token_hex(8),
          "email": str(user.get("email", "")).lower(),
          "username": username,
          "username_lower": username.lower(),
          "password_hash": user.get("password_hash", ""),
          "password_salt": user.get("password_salt", ""),
          "oauth_accounts": user.get("oauth_accounts", {}),
          "created_at": self._parse_datetime(user.get("created_at")),
          "updated_at": self._parse_datetime(user.get("updated_at") or user.get("created_at")),
        }
      )

    if users:
      self._users.insert_many(users, ordered=False)

    rooms = []

    for room in raw_data.get("rooms", []):
      rooms.append(
        {
          "id": room.get("id") or self.generate_room_id(),
          "name": room.get("name"),
          "description": room.get("description", ""),
          "is_public": bool(room.get("is_public", False)),
          "invite_token": str(room.get("invite_token") or self.generate_invite_token()),
          "owner_id": room.get("owner_id", "system"),
          "participant_ids": list(room.get("participant_ids", [])),
          "template_id": room.get("template_id") or "blank",
          "terminal_shell": room.get("terminal_shell") or ("powershell" if os.name == "nt" else "bash"),
          "workspace_tree": self.normalize_workspace_tree(list(room.get("workspace_tree", []))),
          "created_at": self._parse_datetime(room.get("created_at")),
          "updated_at": self._parse_datetime(room.get("updated_at") or room.get("created_at")),
        }
      )

    if rooms:
      self._rooms.insert_many(rooms, ordered=False)

  def _seed_public_rooms(self) -> None:
    timestamp = self._utc_now()
    self._rooms.insert_many(
      [
        {
          "id": "WEB207",
          "name": "Frontend Jam",
          "description": "Build UI ideas together and compare approaches.",
          "is_public": True,
          "invite_token": self.generate_invite_token(),
          "owner_id": "system",
          "participant_ids": [],
          "template_id": "web-starter",
          "terminal_shell": "bash",
          "workspace_tree": self.build_workspace_from_template("web-starter"),
          "created_at": timestamp,
          "updated_at": timestamp,
        },
        {
          "id": "PY101A",
          "name": "Python Practice",
          "description": "Share snippets, notes, and interview drills.",
          "is_public": True,
          "invite_token": self.generate_invite_token(),
          "owner_id": "system",
          "participant_ids": [],
          "template_id": "python-starter",
          "terminal_shell": "bash",
          "workspace_tree": self.build_workspace_from_template("python-starter"),
          "created_at": timestamp,
          "updated_at": timestamp,
        },
      ]
    )


  def _repair_seeded_rooms(self) -> None:
    python_starter_workspace = self.build_workspace_from_template("python-starter")

    self._rooms.update_many(
      {
        "template_id": "python-starter",
        "$or": [
          {"workspace_tree": {"$exists": False}},
          {"workspace_tree": []},
        ],
      },
      {
        "$set": {
          "workspace_tree": python_starter_workspace,
          "updated_at": self._utc_now(),
        }
      },
    )

    self._rooms.update_many(
      {
        "$or": [
          {"invite_token": {"$exists": False}},
          {"invite_token": ""},
        ],
      },
      {
        "$set": {
          "invite_token": self.generate_invite_token(),
          "updated_at": self._utc_now(),
        }
      },
    )

  @staticmethod
  def _normalize_node_name(value: Any) -> str:
    name = str(value or "").strip()

    if not name or "/" in name or "\\" in name or name in {".", ".."}:
      return ""

    return name[:120]

  @staticmethod
  def _build_unique_node_name(existing_names: set[str], node_name: str) -> str:
    lowered_name = node_name.lower()

    if lowered_name not in existing_names:
      existing_names.add(lowered_name)
      return node_name

    dot_index = node_name.rfind(".")
    base_name = node_name if dot_index <= 0 else node_name[:dot_index]
    suffix = "" if dot_index <= 0 else node_name[dot_index:]
    counter = 2

    while True:
      candidate = f"{base_name}-{counter}{suffix}"[:120]
      lowered_candidate = candidate.lower()

      if lowered_candidate not in existing_names:
        existing_names.add(lowered_candidate)
        return candidate

      counter += 1

  @staticmethod
  def _parse_datetime(value: Any) -> datetime:
    if isinstance(value, datetime):
      return value.astimezone(timezone.utc)

    if isinstance(value, str) and value:
      return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)

    return datetime.now(timezone.utc)

  @staticmethod
  def _strip_mongo_id(document: dict[str, Any] | None) -> dict[str, Any] | None:
    if document is None:
      return None

    cloned = dict(document)
    cloned.pop("_id", None)
    return cloned

  @staticmethod
  def _utc_now() -> datetime:
    return datetime.now(timezone.utc)
