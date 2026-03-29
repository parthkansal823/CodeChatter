// Utility for browser-native AES-GCM encryption/decryption

// Derive a 256-bit AES-GCM key from a roomId and a static salt
async function getRoomKey(roomId) {
  const enc = new TextEncoder();
  const keyMaterial = await window.crypto.subtle.importKey(
    "raw",
    enc.encode(roomId + "codechatter-secret-salt-1234"),
    { name: "PBKDF2" },
    false,
    ["deriveKey"]
  );

  return window.crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: enc.encode("room-salt-v1"),
      iterations: 100000,
      hash: "SHA-256"
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

// Encrypt a plaintext string into a base64 ciphertext
export async function encryptText(text, roomId) {
  if (!text) return text;
  
  try {
    const key = await getRoomKey(roomId);
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const enc = new TextEncoder();
    
    const encryptedContent = await window.crypto.subtle.encrypt(
      { name: "AES-GCM", iv: iv },
      key,
      enc.encode(text)
    );
    
    // Package IV + Ciphertext
    const encryptedArray = new Uint8Array(encryptedContent);
    const payload = new Uint8Array(iv.length + encryptedArray.length);
    payload.set(iv, 0);
    payload.set(encryptedArray, iv.length);
    
    // To Base64 string
    return "E2EE~" + btoa(String.fromCharCode.apply(null, payload));
  } catch (error) {
    console.error("Encryption error", error);
    return text; // Fallback
  }
}

// Decrypt a base64 ciphertext back to plaintext
export async function decryptText(encryptedPayload, roomId) {
  if (!encryptedPayload || !encryptedPayload.startsWith("E2EE~")) {
    return encryptedPayload; // Not encrypted or old message
  }
  
  try {
    const base64 = encryptedPayload.substring(5);
    const binary = atob(base64);
    const payload = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      payload[i] = binary.charCodeAt(i);
    }
    
    const iv = payload.slice(0, 12);
    const data = payload.slice(12);
    
    const key = await getRoomKey(roomId);
    const decryptedContent = await window.crypto.subtle.decrypt(
      { name: "AES-GCM", iv: iv },
      key,
      data
    );
    
    const dec = new TextDecoder();
    return dec.decode(decryptedContent);
  } catch (error) {
    console.error("Decryption error", error);
    return "🔒 [Message Corrupted or Key Mismatch]";
  }
}
