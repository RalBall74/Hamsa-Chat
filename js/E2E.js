import { db, doc, getDoc, updateDoc, setDoc } from './firebase-config.js';

export function extendE2E(HamsterApp) {

    HamsterApp.prototype.initE2E = async function() {
        if (!this.user || !this.user.uid) return;

        const storedKey = localStorage.getItem(`hamster_e2e_priv_${this.user.uid}`);
        const storedPubKey = localStorage.getItem(`hamster_e2e_pub_${this.user.uid}`);
        
        if (storedKey && storedPubKey) {
            try {
                this.privateKey = await this.importPrivateKey(storedKey);
                this.publicKey = await this.importPublicKey(storedPubKey);
                console.log("E2E Keys loaded from local storage.");

                // Auto-healing: Ensure public key exists in Firestore
                const userDoc = await getDoc(doc(db, 'users', this.user.uid));
                const userData = userDoc.data();
                if (!userDoc.exists() || !userData.publicKey) {
                    await setDoc(doc(db, 'users', this.user.uid), { publicKey: storedPubKey }, { merge: true });
                }
                
                // Backup existing keys to Vault if not there (Transition logic)
                if (userData && !userData.vault) {
                    await this.backupKeysToVault(storedKey, storedPubKey);
                }
                return;
            } catch (e) {
                console.warn("Local E2E keys corrupted, attempting vault recovery...");
            }
        }

        // --- Vault Recovery Logic ---
        const userDoc = await getDoc(doc(db, 'users', this.user.uid));
        const userData = userDoc.data();

        if (userData && userData.vault) {
            try {
                console.log("Found E2E vault on Firestore, recovering...");
                const decryptedPrivJwk = await this.decryptVault(userData.vault);
                if (decryptedPrivJwk) {
                    localStorage.setItem(`hamster_e2e_priv_${this.user.uid}`, decryptedPrivJwk);
                    localStorage.setItem(`hamster_e2e_pub_${this.user.uid}`, userData.publicKey);
                    this.privateKey = await this.importPrivateKey(decryptedPrivJwk);
                    this.publicKey = await this.importPublicKey(userData.publicKey);
                    console.log("E2E identity recovered from Vault.");
                    return;
                }
            } catch (e) {
                console.error("Vault recovery failed", e);
            }
        }

        // If no vault and no local keys, generate new ones
        await this.generateE2EKeys();
    };

    HamsterApp.prototype.generateE2EKeys = async function() {
        console.log("Generating new E2E Keypair...");
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
        
        const privStr = JSON.stringify(expPriv);
        const pubStr = JSON.stringify(expPub);

        localStorage.setItem(`hamster_e2e_priv_${this.user.uid}`, privStr);
        localStorage.setItem(`hamster_e2e_pub_${this.user.uid}`, pubStr);
        
        await this.backupKeysToVault(privStr, pubStr);
        console.log("E2E Keys generated and vaulted.");
    };

    // --- Vault Encryption & Sync ---
    
    HamsterApp.prototype.backupKeysToVault = async function(privJwk, pubJwk) {
        try {
            // We use a combination of UID and a secret salt to derive a vault key
            // This is "Seamless Sync" - in a real high-security app, you'd use a user password
            const vaultData = await this.encryptVault(privJwk);
            await setDoc(doc(db, 'users', this.user.uid), {
                publicKey: pubJwk,
                vault: vaultData
            }, { merge: true });
        } catch (e) {
            console.error("Vault backup failed", e);
        }
    };

    // Simple Seamless Vault logic (AES-GCM)
    HamsterApp.prototype.getVaultKey = async function() {
        const secret = this.user.uid + "_hamster_vault_v1";
        const encoder = new TextEncoder();
        const keyMaterial = await window.crypto.subtle.importKey(
            "raw", encoder.encode(secret), "PBKDF2", false, ["deriveKey"]
        );
        return await window.crypto.subtle.deriveKey(
            { name: "PBKDF2", salt: encoder.encode(this.user.uid.split('').reverse().join('')), iterations: 100000, hash: "SHA-256" },
            keyMaterial,
            { name: "AES-GCM", length: 256 },
            false,
            ["encrypt", "decrypt"]
        );
    };

    HamsterApp.prototype.encryptVault = async function(text) {
        const key = await this.getVaultKey();
        const iv = window.crypto.getRandomValues(new Uint8Array(12));
        const encoded = new TextEncoder().encode(text);
        const ciphertext = await window.crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded);
        return JSON.stringify({
            ct: this.bufToBase64(ciphertext),
            iv: this.bufToBase64(iv)
        });
    };

    HamsterApp.prototype.decryptVault = async function(vaultJson) {
        try {
            const { ct, iv } = JSON.parse(vaultJson);
            const key = await this.getVaultKey();
            const decrypted = await window.crypto.subtle.decrypt(
                { name: "AES-GCM", iv: new Uint8Array(this.base64ToBuf(iv)) },
                key,
                this.base64ToBuf(ct)
            );
            return new TextDecoder().decode(decrypted);
        } catch (e) { return null; }
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
                // Own public key - Use the one currently being used by this session (from Vault or freshly generated)
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

        // Fallback for non-participants (e.g. Admin or third-party view)
        if (!msgObj.keys || !msgObj.keys[this.user.uid]) {
            return {
                ...msgObj,
                text: (this.lang === 'ar' ? '🔒 محتوى مشفّر' : '🔒 Encrypted Content'),
                decrypted: false,
                isEncryptedPlaceholder: true
            };
        }

        // Fallback if local keys haven't loaded yet (Vault recovery in progress)
        if (!this.privateKey) {
            return {
                ...msgObj,
                text: (this.lang === 'ar' ? '🔒 جارٍ استعادة مفاتيح الأمان...' : '🔒 Loading Security Keys...'),
                decrypted: false
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

            return {
                ...msgObj,
                ...payloadObj,
                decrypted: true
            };
        } catch (e) {
            console.error("Failed to decrypt message payload", e);
            
            // Helpful error mapping
            let errorMsg = "⚠️ هذه الرسالة مشفرة ولا يمكن فك تشفيرها (المفتاح مفقود).";
            if (e.name === "OperationError") {
                errorMsg = "⚠️ عذراً، هذه الرسالة مشفرة بهوية حماية قديمة (قبل مزامنة أجهزتك).";
            } else if (!this.privateKey) {
                errorMsg = "⚠️ فشل الأمان: مفتاح التشفير الخاص بك غير جاهز بعد.";
            }

            return {
                ...msgObj,
                text: errorMsg,
                decrypted: false
            };
        }
    };

    HamsterApp.prototype.resetE2EIdentity = async function() {
        this.showConfirm(
            this.lang === 'ar' ? 'إعادة ضبط التشفير' : 'Reset Encryption',
            this.lang === 'ar' ? 'هل أنت متأكد؟ ستقوم بإنشاء هوية تشفير جديدة. الرسائل السابقة المشفّرة قد لا تفتح على هذا الجهاز بعد الآن.' : 'Are you sure? This will regenerate your encryption identity. Older encrypted messages might become unreadable on this device.',
            async () => {
                localStorage.removeItem(`hamster_e2e_priv_${this.user.uid}`);
                localStorage.removeItem(`hamster_e2e_pub_${this.user.uid}`);
                await this.generateE2EKeys();
                this.showAlert(this.lang === 'ar' ? 'تم الضبط' : 'Reset Complete', this.lang === 'ar' ? 'تم تحديث هوية التشفير الخاصة بك ومزامنتها.' : 'Encryption identity reset and synced.');
                window.location.reload();
            }
        );
    };
}
