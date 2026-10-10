// Sign-in configuration.
//
// Leave firebase.apiKey empty to run in demo mode: email accounts are stored
// only in this browser, and the Google button explains that it needs
// setup. Paste the values from your Firebase project to turn on real
// sign-in (see README.md, "Sign-in setup").
//
// Firebase console → Project settings → General → Your apps → Web app → Config
window.AUTH_CONFIG = {
  firebase: {
    apiKey: 'AIzaSyDOZVRfdZyVjJmz0OtgtwNWIxnmM90p1FQ',
    authDomain: 'java-sev.firebaseapp.com',
    projectId: 'java-sev',
    storageBucket: 'java-sev.firebasestorage.app',
    messagingSenderId: '49059981762',
    appId: '1:49059981762:web:cdef12a071357b87528e5b',
  },

  // Each provider must also be enabled in
  // Firebase console → Authentication → Sign-in method.
  providers: {
    google: true,
    email: true,
  },
};
