// ══════════════════════════════════════════════════════════
// OLANIYI MOBILE REPAIR — Backend v2.0
// Firebase Admin SDK + FCM Push Notifications
// Déployer sur Vercel : vercel.com
// ══════════════════════════════════════════════════════════

const express     = require('express');
const cors        = require('cors');
const admin       = require('firebase-admin');

const app = express();
app.use(express.json());
app.use(cors({ origin: '*', methods: ['GET', 'POST', 'OPTIONS'] }));

// ── FIREBASE ADMIN INIT ───────────────────────────────────
// Les variables d'environnement Vercel contiennent le service account
const serviceAccount = {
  type:                        "service_account",
  project_id:                  process.env.FB_PROJECT_ID,
  private_key_id:              process.env.FB_PRIVATE_KEY_ID,
  private_key:                 (process.env.FB_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
  client_email:                process.env.FB_CLIENT_EMAIL,
  client_id:                   process.env.FB_CLIENT_ID,
  auth_uri:                    "https://accounts.google.com/o/oauth2/auth",
  token_uri:                   "https://oauth2.googleapis.com/token",
  auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
  client_x509_cert_url:        process.env.FB_CERT_URL,
};

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: `https://${process.env.FB_PROJECT_ID}.firebaseio.com`,
  });
}

const db  = admin.firestore();
const fcm = admin.messaging();

// ══════════════════════════════════════════════════════════
// ROUTES NOTIFICATIONS FCM
// ══════════════════════════════════════════════════════════

// ── Enregistrer token FCM d'un client ou admin ────────────
// POST /api/save-token
// Body: { token, type: 'client'|'admin', orderId? }
app.post('/api/save-token', async (req, res) => {
  try {
    const { token, type, orderId } = req.body;
    if (!token || !type) return res.status(400).json({ error: 'token et type requis' });

    const docRef = type === 'admin'
      ? db.collection('fcm_tokens').doc('admin_token')
      : db.collection('fcm_tokens').doc(orderId || token.slice(-20));

    await docRef.set({ token, type, updatedAt: new Date().toISOString() }, { merge: true });
    res.json({ success: true });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Notifier l'ADMIN d'une nouvelle commande ─────────────
// POST /api/notify-admin
// Body: { orderCode, service, client, montant }
app.post('/api/notify-admin', async (req, res) => {
  try {
    const { orderCode, service, client, montant } = req.body;

    // Récupérer le token admin
    const snap = await db.collection('fcm_tokens').doc('admin_token').get();
    if (!snap.exists) return res.json({ success: false, msg: 'Admin token non enregistré' });

    const adminToken = snap.data().token;

    const message = {
      token: adminToken,
      notification: {
        title: '🛒 Nouvelle commande !',
        body:  `${client} — ${service} · ${montant}`,
      },
      data: {
        orderCode,
        type: 'new_order',
        url:  `${process.env.SITE_URL || ''}#admin`,
      },
      webpush: {
        fcmOptions: { link: `${process.env.SITE_URL || ''}#admin` },
        notification: {
          title: '🛒 Nouvelle commande !',
          body:  `${client} — ${service} · ${montant}`,
          icon:  '/icon-192.png',
          badge: '/icon-72.png',
          tag:   'new-order-' + orderCode,
          requireInteraction: true,
          actions: [
            { action: 'open', title: '👁️ Voir la commande' },
            { action: 'close', title: 'Fermer' },
          ],
        },
      },
    };

    await fcm.send(message);
    res.json({ success: true });
  } catch(e) {
    console.error('notify-admin:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Notifier le CLIENT du changement de statut ────────────
// POST /api/notify-client
// Body: { orderCode, status, statusNote, clientToken }
app.post('/api/notify-client', async (req, res) => {
  try {
    const { orderCode, status, statusNote, clientToken } = req.body;

    // Chercher le token client si non fourni
    let token = clientToken;
    if (!token) {
      const snap = await db.collection('fcm_tokens').doc(orderCode).get();
      if (!snap.exists) return res.json({ success: false, msg: 'Token client introuvable' });
      token = snap.data().token;
    }

    const statusLabels = {
      pending:    '⏳ En attente de traitement',
      processing: '⚙️ En cours de traitement',
      success:    '✅ Commande traitée avec succès !',
      rejected:   '❌ Commande rejetée',
    };

    const label = statusLabels[status] || status;
    const body  = statusNote
      ? `${label}\n💬 ${statusNote}`
      : label;

    const message = {
      token,
      notification: { title: `📦 Commande ${orderCode}`, body },
      data: {
        orderCode,
        status,
        type: 'status_update',
        url:  process.env.SITE_URL || '',
      },
      webpush: {
        fcmOptions: { link: process.env.SITE_URL || '' },
        notification: {
          title: `📦 Commande ${orderCode}`,
          body,
          icon:  '/icon-192.png',
          badge: '/icon-72.png',
          tag:   'status-' + orderCode,
          requireInteraction: status === 'success' || status === 'rejected',
          actions: [
            { action: 'track', title: '🔍 Voir le statut' },
            { action: 'close', title: 'Fermer' },
          ],
        },
      },
    };

    await fcm.send(message);
    res.json({ success: true });
  } catch(e) {
    console.error('notify-client:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Sanity check ──────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'Olaniyi Backend v2.0',
    timestamp: new Date().toISOString(),
    firebase: !!admin.apps.length,
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Backend v2.0 démarré sur le port ${PORT}`));
module.exports = app;
