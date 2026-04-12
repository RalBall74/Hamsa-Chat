const CACHE_NAME = 'hamster-chat-v21';
const STATIC_ASSETS = [
    './',
    './index.html',
    './manifest.json',
    './css/variables.css',
    './css/style.css',
    './css/glass.css',
    './css/animations.css',
    './js/app.js',
    './js/firebase-config.js',
    './js/auth.js',
    './js/calls.js',
    './js/ai.js',
    './js/stories.js',
    './js/ui.js',
    './js/admin.js',
    './js/settings.js',
    './js/media.js',
    './js/E2E.js',
    './assets/logo.jpg',
    './assets/Google.png',
    './assets/audio/callringtone.mp3',
    './assets/icons/icon-192.png',
    './assets/icons/app_icon_512_1772927838563.png',
    'https://unpkg.com/lucide@0.474.0/dist/umd/lucide.min.js',
    'https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&display=swap',
    'https://download.agora.io/sdk/release/AgoraRTC_N-4.22.0.js',
    'https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js',
    'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js',
    'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js',
    'https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js'
];

// Install: Cache static assets
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => {
            console.log('SW: Pre-caching static assets');
            return cache.addAll(STATIC_ASSETS);
        })
    );
    self.skipWaiting();
});

// Activate: Cleanup old caches
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys => {
            return Promise.all(
                keys.filter(key => key !== CACHE_NAME)
                    .map(key => caches.delete(key))
            );
        })
    );
    self.clients.claim();
});

// Fetch Strategy
self.addEventListener('fetch', event => {
    if (event.request.method !== 'GET') return;

    const requestURL = new URL(event.request.url);

    // Navigation fallback: if network fails for a page request, return index.html
    const isNavigation = event.request.mode === 'navigate';
    
    event.respondWith(
        fetch(event.request)
            .then(networkResponse => {
                // If network works, cache and return
                if (networkResponse.status === 200 || networkResponse.type === 'opaque') {
                    const responseClone = networkResponse.clone();
                    caches.open(CACHE_NAME).then(cache => {
                        cache.put(event.request, responseClone);
                    });
                }
                return networkResponse;
            })
            .catch(() => {
                // If network fails, try cache
                return caches.match(event.request).then(cachedResponse => {
                    if (cachedResponse) return cachedResponse;
                    
                    // Specific fallback for navigation
                    if (isNavigation) {
                        return caches.match('./index.html');
                    }
                    return null;
                });
            })
    );
});
