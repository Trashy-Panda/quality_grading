// auth.js — Firebase Auth for Beef Grading Drill
// Depends on: firebase-app-compat, firebase-auth-compat, firebase-firestore-compat CDN scripts
// Depends on: FIREBASE_CONFIG and DB_COLLECTIONS defined in data.js

(function () {
  'use strict';

  // ── Initialize Firebase ───────────────────────────────────────────────────

  firebase.initializeApp(FIREBASE_CONFIG);

  window._db = firebase.firestore();
  window._auth = firebase.auth();
  window._currentUser = null;

  // ── Auth State Observer ───────────────────────────────────────────────────

  window._auth.onAuthStateChanged(async function (user) {
    window._currentUser = user;

    if (user) {
      await _ensureUserDocument(user);
    }

    _updateAuthHeader(user);

    document.dispatchEvent(new CustomEvent('authStateChanged', { detail: { user } }));
  });

  // ── Firestore: create/merge user document on first sign-in ───────────────

  async function _ensureUserDocument(user) {
    try {
      const ref = window._db.collection(DB_COLLECTIONS.users).doc(user.uid);
      await ref.set(
        {
          displayName: user.displayName || '',
          email: user.email || '',
          photoURL: user.photoURL || '',
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    } catch (err) {
      console.error('[auth] Failed to write user document:', err);
    }
  }

  // ── Provider Sign-In ─────────────────────────────────────────────────────

  function signInWithGoogle() {
    const provider = new firebase.auth.GoogleAuthProvider();
    provider.addScope('profile');
    provider.addScope('email');
    return window._auth.signInWithPopup(provider).then(function () {
      closeAuthModal();
    }).catch(function (err) {
      if (err.code !== 'auth/popup-closed-by-user' && err.code !== 'auth/cancelled-popup-request') {
        console.error('[auth] Google sign-in error:', err);
        _showAuthError('Google sign-in failed. Please try again.');
      }
    });
  }

  function signInWithGitHub() {
    const provider = new firebase.auth.GithubAuthProvider();
    provider.addScope('read:user');
    return window._auth.signInWithPopup(provider).then(function () {
      closeAuthModal();
    }).catch(function (err) {
      if (err.code !== 'auth/popup-closed-by-user' && err.code !== 'auth/cancelled-popup-request') {
        console.error('[auth] GitHub sign-in error:', err);
        _showAuthError('GitHub sign-in failed. Please try again.');
      }
    });
  }

  function signOut() {
    return window._auth.signOut().catch(function (err) {
      console.error('[auth] Sign-out error:', err);
    });
  }

  // ── Modal Controls ────────────────────────────────────────────────────────

  function openAuthModal() {
    const modal = document.getElementById('auth-modal');
    if (modal) {
      modal.classList.remove('hidden');
      document.body.style.overflow = 'hidden';
    }
  }

  function closeAuthModal() {
    const modal = document.getElementById('auth-modal');
    if (modal) {
      modal.classList.add('hidden');
      document.body.style.overflow = '';
    }
    _clearAuthError();
  }

  // ── Header UI ─────────────────────────────────────────────────────────────

  function _updateAuthHeader(user) {
    // Update both the drill header and home screen nav auth areas
    const areas = [
      { signin: 'auth-signin-btn',  userArea: 'auth-user-area',  avatar: 'auth-avatar',  name: 'auth-display-name'  },
      { signin: 'home-signin-btn',  userArea: 'home-user-area',  avatar: 'home-avatar',  name: 'home-display-name'  },
    ];

    areas.forEach(function(ids) {
      const signinBtn  = document.getElementById(ids.signin);
      const userArea   = document.getElementById(ids.userArea);
      const avatar     = document.getElementById(ids.avatar);
      const displayName = document.getElementById(ids.name);

      if (!signinBtn || !userArea) return;

      if (user) {
        signinBtn.classList.add('hidden');
        userArea.classList.remove('hidden');
        if (avatar) {
          avatar.src = user.photoURL || '';
          avatar.alt = user.displayName || 'User';
          avatar.style.display = user.photoURL ? '' : 'none';
        }
        if (displayName) {
          displayName.textContent = user.displayName || user.email || 'Signed In';
        }
      } else {
        signinBtn.classList.remove('hidden');
        userArea.classList.add('hidden');
      }
    });
  }

  // ── Error Display ─────────────────────────────────────────────────────────

  function _showAuthError(message) {
    let errEl = document.getElementById('auth-modal-error');
    if (!errEl) {
      errEl = document.createElement('p');
      errEl.id = 'auth-modal-error';
      errEl.className = 'auth-modal-error';
      const panel = document.getElementById('auth-modal-panel');
      if (panel) {
        const disclaimer = panel.querySelector('.auth-modal-disclaimer');
        if (disclaimer) {
          panel.insertBefore(errEl, disclaimer);
        } else {
          panel.appendChild(errEl);
        }
      }
    }
    errEl.textContent = message;
  }

  function _clearAuthError() {
    const errEl = document.getElementById('auth-modal-error');
    if (errEl) errEl.remove();
  }

  // ── DOM Ready: attach event listeners ────────────────────────────────────

  document.addEventListener('DOMContentLoaded', function () {
    const signinBtn = document.getElementById('auth-signin-btn');
    const modalClose = document.getElementById('auth-modal-close');
    const modalOverlay = document.getElementById('auth-modal');
    const modalPanel = document.getElementById('auth-modal-panel');
    const googleBtn = document.getElementById('auth-google-btn');
    const githubBtn = document.getElementById('auth-github-btn');
    const signoutBtn = document.getElementById('auth-signout-btn');

    if (signinBtn) {
      signinBtn.addEventListener('click', openAuthModal);
    }

    if (modalClose) {
      modalClose.addEventListener('click', closeAuthModal);
    }

    // Click on overlay (outside panel) closes modal
    if (modalOverlay) {
      modalOverlay.addEventListener('click', function (e) {
        if (e.target === modalOverlay) closeAuthModal();
      });
    }

    if (googleBtn) {
      googleBtn.addEventListener('click', signInWithGoogle);
    }

    if (githubBtn) {
      githubBtn.addEventListener('click', signInWithGitHub);
    }

    if (signoutBtn) {
      signoutBtn.addEventListener('click', signOut);
    }

    // Home screen nav auth buttons
    const homeSigninBtn  = document.getElementById('home-signin-btn');
    const homeSignoutBtn = document.getElementById('home-signout-btn');
    if (homeSigninBtn)  homeSigninBtn.addEventListener('click', openAuthModal);
    if (homeSignoutBtn) homeSignoutBtn.addEventListener('click', signOut);

    // Escape key closes modal
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        const modal = document.getElementById('auth-modal');
        if (modal && !modal.classList.contains('hidden')) {
          closeAuthModal();
        }
      }
    });
  });

  // ── Public API ────────────────────────────────────────────────────────────

  window.signInWithGoogle = signInWithGoogle;
  window.signInWithGitHub = signInWithGitHub;
  window.signOut = signOut;
  window.openAuthModal = openAuthModal;
  window.closeAuthModal = closeAuthModal;
  window.updateAuthHeader = _updateAuthHeader;
})();
