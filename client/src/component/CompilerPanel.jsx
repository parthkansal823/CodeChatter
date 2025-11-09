import React, { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

function CompilerPanel({ output, runCode, isCompiling, selectedLanguage }) {
  const [isVisible, setIsVisible] = useState(true);
  const outputRef = useRef(null);

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTo({
        top: outputRef.current.scrollHeight,
        behavior: "smooth",
      });
    }
  }, [output]);

  return (
    <motion.div
      className="compiler-window"
      initial={{ opacity: 0, y: 25 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 20 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
    >
      {/* Header */}
      <div className="compiler-header">
        <motion.h5
          initial={{ opacity: 0, x: -15 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.3 }}
        >
          ⚙️ Compiler Output <span>({selectedLanguage})</span>
        </motion.h5>

        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <button
            className="btn-clear"
            onClick={() => setIsVisible((prev) => !prev)}
          >
            {isVisible ? "Hide" : "Show"}
          </button>

          <button className="btn-run" onClick={runCode} disabled={isCompiling}>
            {isCompiling ? "⏳ Compiling..." : "▶️ Run Code"}
          </button>
        </div>
      </div>

      <AnimatePresence>
        {isVisible && (
          <motion.pre
            ref={outputRef}
            key="output"
            className="compiler-output"
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 15 }}
            transition={{ duration: 0.3 }}
          >
            {output
              ? output
              : "💡 Output will appear here once you run your code."}
          </motion.pre>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export default CompilerPanel;
