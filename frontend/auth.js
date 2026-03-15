(function () {
  const AUTH_KEY = 'firebaseAuth';
  const EDITOR_PAGE = 'index.html';

  const formSignIn = document.getElementById('form-signin');
  const formSignUp = document.getElementById('form-signup');
  const btnSignIn = document.getElementById('btn-signin');
  const btnSignUp = document.getElementById('btn-signup');
  const btnGoogle = document.getElementById('btn-google');
  const btnGithub = document.getElementById('btn-github');
  const authMessage = document.getElementById('auth-message');
  const tabs = document.querySelectorAll('.auth-tab');

  function showMessage(text, isError) {
    authMessage.textContent = text;
    authMessage.hidden = false;
    authMessage.className = 'auth-message ' + (isError ? 'auth-message-error' : 'auth-message-success');
  }

  function hideMessage() {
    authMessage.hidden = true;
    authMessage.textContent = '';
  }

  function setLoading(button, loading) {
    if (!button) return;
    button.disabled = loading;
    button.textContent = loading ? 'Please wait…' : (button.id === 'btn-signin' ? 'Sign In' : 'Create Account');
  }

  function goToEditor() {
    try {
      localStorage.setItem(AUTH_KEY, '1');
    } catch (e) {}
    if (window.editorAPI && typeof window.editorAPI.showEditorMenu === 'function') {
      window.editorAPI.showEditorMenu();
    }
    window.location.href = EDITOR_PAGE;
  }

  function getAuth() {
    if (typeof firebase === 'undefined' || !firebase.auth) return null;
    if (!window.firebaseAuth) {
      const firebaseConfig = {
        apiKey: "AIzaSyBxhtyu-c53uG5Ypzy_4gY45r5z6a29KYU",
        authDomain: "electron-auth-app.firebaseapp.com",
        projectId: "electron-auth-app",
        storageBucket: "electron-auth-app.firebasestorage.app",
        messagingSenderId: "746611017522",
        appId: "1:746611017522:web:1970c784e91d743461b92b",
        measurementId: "G-Y1V83R1XKZ"
      };
      if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
      window.firebaseAuth = firebase.auth();
    }
    return window.firebaseAuth;
  }

  // If already signed in, go to editor
  var auth = getAuth();
  if (auth) {
    auth.onAuthStateChanged(function (user) {
      if (user) {
        goToEditor();
      }
    });
  }

  // Tab switch
  tabs.forEach(function (tab) {
    tab.addEventListener('click', function () {
      const target = this.getAttribute('data-tab');
      tabs.forEach(function (t) {
        t.classList.toggle('active', t.getAttribute('data-tab') === target);
        t.setAttribute('aria-selected', t.getAttribute('data-tab') === target ? 'true' : 'false');
      });
      document.querySelectorAll('.auth-form').forEach(function (form) {
        form.classList.toggle('hidden', form.getAttribute('data-tab') !== target);
      });
      hideMessage();
    });
  });

  // Sign In
  if (formSignIn) {
    formSignIn.addEventListener('submit', function (e) {
      e.preventDefault();
      hideMessage();
      const email = document.getElementById('signin-email').value.trim();
      const password = document.getElementById('signin-password').value;
      if (!email || !password) {
        showMessage('Please enter email and password.', true);
        return;
      }
      auth = getAuth();
      if (!auth) {
        showMessage('Firebase Auth is not available.', true);
        return;
      }
      setLoading(btnSignIn, true);
      auth.signInWithEmailAndPassword(email, password)
        .then(function () {
          goToEditor();
        })
        .catch(function (err) {
          setLoading(btnSignIn, false);
          showMessage(err.message || 'Sign in failed.', true);
        });
    });
  }

  // Sign Up
  if (formSignUp) {
    formSignUp.addEventListener('submit', function (e) {
      e.preventDefault();
      hideMessage();
      const email = document.getElementById('signup-email').value.trim();
      const password = document.getElementById('signup-password').value;
      if (!email || !password) {
        showMessage('Please enter email and password.', true);
        return;
      }
      if (password.length < 6) {
        showMessage('Password must be at least 6 characters.', true);
        return;
      }
      auth = getAuth();
      if (!auth) {
        showMessage('Firebase Auth is not available.', true);
        return;
      }
      setLoading(btnSignUp, true);
      auth.createUserWithEmailAndPassword(email, password)
        .then(function () {
          goToEditor();
        })
        .catch(function (err) {
          setLoading(btnSignUp, false);
          showMessage(err.message || 'Sign up failed.', true);
        });
    });
  }

  // Google
  if (btnGoogle) {
    btnGoogle.addEventListener('click', function () {
      hideMessage();
      auth = getAuth();
      if (!auth) {
        showMessage('Firebase Auth is not available.', true);
        return;
      }
      var provider = new firebase.auth.GoogleAuthProvider();
      btnGoogle.disabled = true;
      auth.signInWithPopup(provider)
        .then(function () {
          goToEditor();
        })
        .catch(function (err) {
          btnGoogle.disabled = false;
          showMessage(err.message || 'Google sign in failed.', true);
        });
    });
  }

  // GitHub
  if (btnGithub) {
    btnGithub.addEventListener('click', function () {
      hideMessage();
      auth = getAuth();
      if (!auth) {
        showMessage('Firebase Auth is not available.', true);
        return;
      }
      var provider = new firebase.auth.GithubAuthProvider();
      btnGithub.disabled = true;
      auth.signInWithPopup(provider)
        .then(function () {
          goToEditor();
        })
        .catch(function (err) {
          btnGithub.disabled = false;
          showMessage(err.message || 'GitHub sign in failed.', true);
        });
    });
  }
})();
