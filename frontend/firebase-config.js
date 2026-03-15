// Firebase configuration and initialization
// Uses global firebase from CDN (loaded in auth.html)
(function () {
  if (typeof firebase === 'undefined') return;

  const firebaseConfig = {
    apiKey: "AIzaSyBxhtyu-c53uG5Ypzy_4gY45r5z6a29KYU",
    authDomain: "electron-auth-app.firebaseapp.com",
    projectId: "electron-auth-app",
    storageBucket: "electron-auth-app.firebasestorage.app",
    messagingSenderId: "746611017522",
    appId: "1:746611017522:web:1970c784e91d743461b92b",
    measurementId: "G-Y1V83R1XKZ"
  };

  if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
  }
  if (typeof firebase.analytics !== 'undefined') {
    try {
      firebase.analytics();
    } catch (e) {
      // analytics optional
    }
  }
  window.firebaseApp = firebase.app();
  window.firebaseAuth = firebase.auth();
})();
