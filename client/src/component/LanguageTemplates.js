// =========================================
// 🌐 Default Code Templates for CodeChatter
// =========================================

const LANGUAGE_TEMPLATES = {
  python3: `def main():
    print("Hello, CodeChatter!")

if __name__ == "__main__":
    main()`,

  java: `public class Main {
    public static void main(String[] args) {
        System.out.println("Hello, CodeChatter!");
    }
}`,

  cpp: `#include <iostream>
using namespace std;

int main() {
    cout << "Hello, CodeChatter!" << endl;
    return 0;
}`,

  c: `#include <stdio.h>

int main() {
    printf("Hello, CodeChatter!\\n");
    return 0;
}`,

  nodejs: `console.log("Hello, CodeChatter!");`,

  php: `<?php
echo "Hello, CodeChatter!";
?>`,

  go: `package main
import "fmt"

func main() {
    fmt.Println("Hello, CodeChatter!")
}`,

  rust: `fn main() {
    println!("Hello, CodeChatter!");
}`,

  swift: `import Foundation

print("Hello, CodeChatter!")`,

  ruby: `puts "Hello, CodeChatter!"`,

  bash: `#!/bin/bash
echo "Hello, CodeChatter!"`,

  sql: `SELECT "Hello, CodeChatter!" AS message;`,

  csharp: `using System;

class Program {
    static void Main() {
        Console.WriteLine("Hello, CodeChatter!");
    }
}`,

  r: `print("Hello, CodeChatter!")`,

  scala: `object Main extends App {
    println("Hello, CodeChatter!")
}`,
};

// =========================================
// 🔧 Export Helper
// =========================================

/**
 * Returns a language-specific boilerplate.
 * Falls back to empty string if language is not defined.
 *
 * @param {string} language - The language key (e.g. "python3", "cpp", "nodejs")
 * @returns {string} - The code template string
 */
export function getLanguageTemplate(language) {
  const normalized = language?.toLowerCase().trim();
  return LANGUAGE_TEMPLATES[normalized] || "// No default template available for this language.";
}
