import { db, doc, getDoc, updateDoc, setDoc } from './firebase-config.js';

export function extendE2E(HamsterApp) {

    HamsterApp.prototype.initE2E = async function() {
        if (!this.user || !this.user.uid) return;

        try {
            // 1. Check Cloud First (Multi-Device Auto-Sync)
            const userDoc = await getDoc(doc(db, 'users', this.user.uid));
            const cloudData = userDoc.exists() ? userDoc.data() : null;

            if (cloudData && cloudData.publicKey && cloudData.privateKey) {
                // Keys exist in cloud, sync them locally
                this.privateKey = await this.importPrivateKey(cloudData.privateKey);
                this.publicKey = await this.importPublicKey(cloudData.publicKey);
                
                localStorage.setItem(`hamster_e2e_priv_${this.user.uid}`, cloudData.privateKey);
                localStorage.setItem(`hamster_e2e_pub_${this.user.uid}`, cloudData.publicKey);
                console.log("E2E Keys synced seamlessly from Cloud (Multi-Device Active).");
                return;
            }

            // 2. Check LocalStorage (Fast Path & Legacy Recovery)
            const storedKey = localStorage.getItem(`hamster_e2e_priv_${this.user.uid}`);
            const storedPubKey = localStorage.getItem(`hamster_e2e_pub_${this.user.uid}`);
            
            if (storedKey && storedPubKey) {
                this.privateKey = await this.importPrivateKey(storedKey);
                this.publicKey = await this.importPublicKey(storedPubKey);
                console.log("E2E Keys loaded from local storage.");

                // Auto-healing: Push local keys to cloud for future devices
                if (cloudData && (!cloudData.publicKey || !cloudData.privateKey)) {
                    await setDoc(doc(db, 'users', this.user.uid), { 
                        publicKey: storedPubKey,
                        privateKey: storedKey 
                    }, { merge: true });
                    console.log("E2E keys backed up to Cloud.");
                }
                return;
            }

            // 3. Generate New Keys if absolutely no keys found
            await this.generateE2EKeys();
            
        } catch (e) {
            console.error("Critical E2E Init Error:", e);
            // Fallback generation
            await this.generateE2EKeys();
        }
    };

    HamsterApp.prototype.generateE2EKeys = async function() {
        console.log("Generating fresh E2E Keypair...");
        const keyPair = await window.crypto.subtle.generateKey(
            {
                name: "RSA-OAEP",
                modulusLength: 2048,
                publicExponent: new Uint8Array([1, 0, 1]),
                hash: "SHA-256",
            },
            true,
            ["encrypt", "decrypt"]
        );
        
        this.privateKey = keyPair.privateKey;
        this.publicKey = keyPair.publicKey;
        
        const expPriv = await window.crypto.subtle.exportKey("jwk", this.privateKey);
        const expPub = await window.crypto.subtle.exportKey("jwk", this.publicKey);
        
        const strPriv = JSON.stringify(expPriv);
        const strPub = JSON.stringify(expPub);

        localStorage.setItem(`hamster_e2e_priv_${this.user.uid}`, strPriv);
        localStorage.setItem(`hamster_e2e_pub_${this.user.uid}`, strPub);
        
        await setDoc(doc(db, 'users', this.user.uid), {
            publicKey: strPub,
            privateKey: strPriv // Secured via Firestore Rules strictly strictly matching request.auth.uid
        }, { merge: true });
        
        console.log("E2E Keys generated and synced to Cloud.");
    };

    HamsterApp.prototype.importPrivateKey = async function(jwkStr) {
        return await window.crypto.subtle.importKey(
            "jwk",
            JSON.parse(jwkStr),
            { name: "RSA-OAEP", hash: "SHA-256" },
            true,
            ["decrypt"]
        );
    };

    HamsterApp.prototype.importPublicKey = async function(jwkStr) {
        return await window.crypto.subtle.importKey(
            "jwk",
            JSON.parse(jwkStr),
            { name: "RSA-OAEP", hash: "SHA-256" },
            true,
            ["encrypt"]
        );
    };

    HamsterApp.prototype.bufToBase64 = function(buffer) {
        let binary = '';
        const bytes = new Uint8Array(buffer);
        const len = bytes.byteLength;
        for (let i = 0; i < len; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return window.btoa(binary);
    };

    HamsterApp.prototype.base64ToBuf = function(base64) {
        const binary_string = window.atob(base64);
        const len = binary_string.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = binary_string.charCodeAt(i);
        }
        return bytes.buffer;
    };

    // Encrypts a message payload (text and/or media references)
    // Returns { ciphertext, iv, keys: { userId: encryptedSymmetricKey } }
    HamsterApp.prototype.encryptMessagePayload = async function(chat, payloadObj) {
        const payloadStr = JSON.stringify(payloadObj);
        const encodedPayload = new TextEncoder().encode(payloadStr);

        // Generate Symmetric AES Key
        const aesKey = await window.crypto.subtle.generateKey(
            { name: "AES-GCM", length: 256 },
            true,
            ["encrypt", "decrypt"]
        );

        // Encrypt Payload using AES-GCM
        const iv = window.crypto.getRandomValues(new Uint8Array(12));
        const ciphertextBuf = await window.crypto.subtle.encrypt(
            { name: "AES-GCM", iv: iv },
            aesKey,
            encodedPayload
        );
        const ciphertext = this.bufToBase64(ciphertextBuf);
        const ivBase64 = this.bufToBase64(iv.buffer);

        // Export AES Key
        const rawAesKey = await window.crypto.subtle.exportKey("raw", aesKey);

        // Encrypt AES Key for each member
        const keysObj = {};
        for (const uid of chat.memberIds) {
            let pubKeyBuf;
            if (uid === this.user.uid) {
                // Own public key
                const storedPubKey = localStorage.getItem(`hamster_e2e_pub_${this.user.uid}`);
                pubKeyBuf = storedPubKey;
            } else {
                // Fetch member's public key from Firestore user doc
                const memberDoc = await getDoc(doc(db, 'users', uid));
                if (memberDoc.exists() && memberDoc.data().publicKey) {
                    pubKeyBuf = memberDoc.data().publicKey;
                }
            }

            if (pubKeyBuf) {
                try {
                    const pubKey = await this.importPublicKey(pubKeyBuf);
                    const encAesKeyBuf = await window.crypto.subtle.encrypt(
                        { name: "RSA-OAEP" },
                        pubKey,
                        rawAesKey
                    );
                    keysObj[uid] = this.bufToBase64(encAesKeyBuf);
                } catch (e) {
                    console.error("Failed to encrypt for user", uid, e);
                }
            }
        }

        return {
            ciphertext,
            iv: ivBase64,
            keys: keysObj,
            isE2E: true
        };
    };

    HamsterApp.prototype.decryptMessagePayload = async function(msgObj) {
        if (!msgObj.isE2E) return msgObj;

        if (!msgObj.keys || !msgObj.keys[this.user.uid] || !this.privateKey) {
            return {
                decrypted: false,
                text: "⚠️ هذه الرسالة مشفرة ولا يمكن فك تشفيرها.",
                type: 'text'
            };
        }

        try {
            const encryptedAesKeyBase64 = msgObj.keys[this.user.uid];
            const encryptedAesKeyBuf = this.base64ToBuf(encryptedAesKeyBase64);

            // Decrypt AES Key using our Private Key
            const rawAesKey = await window.crypto.subtle.decrypt(
                { name: "RSA-OAEP" },
                this.privateKey,
                encryptedAesKeyBuf
            );

            const aesKey = await window.crypto.subtle.importKey(
                "raw",
                rawAesKey,
                { name: "AES-GCM" },
                false,
                ["decrypt"]
            );

            // Decrypt Ciphertext
            const ivBuf = this.base64ToBuf(msgObj.iv);
            const cipherBuf = this.base64ToBuf(msgObj.ciphertext);

            const decodedPayloadBuf = await window.crypto.subtle.decrypt(
                { name: "AES-GCM", iv: new Uint8Array(ivBuf) },
                aesKey,
                cipherBuf
            );

            const payloadStr = new TextDecoder().decode(decodedPayloadBuf);
            const payloadObj = JSON.parse(payloadStr);

            // Return merged object
            return {
                ...msgObj,
                ...payloadObj,
                decrypted: true
            };
        } catch (e) {
            console.error("Failed to decrypt message payload", e);
            return {
                ...msgObj,
                text: "⚠️ هذه الرسالة مشفرة ولا يمكن فك تشفيرها (المفتاح مفقود).",
                decrypted: false
            };
        }
    };
}
