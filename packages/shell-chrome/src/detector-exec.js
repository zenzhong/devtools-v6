import { installToast } from '@back/toast'

function sendMessage(message) {
  window.postMessage({
    key: '_vue-devtools-send-message',
    message,
  })
}

function detect() {
  let delay = 1000
  let detectRemainingTries = 10

  function runDetect() {
    // Method 1: Check Nuxt.js
    const nuxtDetected = !!(window.__NUXT__ || window.$nuxt)

    if (nuxtDetected) {
      sendMessage({
        devtoolsEnabled: true,
        vueDetected: true,
        nuxtDetected: true,
      }, '*')

      return
    }

    // Method 2: Check  Vue 3
    const vueDetected = !!(window.__VUE__)
    if (vueDetected) {
      sendMessage({
        devtoolsEnabled: true,
        vueDetected: true,
      }, '*')

      return
    }

    // Method 3: Scan all elements inside document
    const all = document.querySelectorAll('*')
    let el
    for (let i = 0; i < all.length; i++) {
      if (all[i].__vue__ || all[i].__vue_app__) {
        el = all[i]
        break
      }
    }
    if (el) {
      sendMessage({
        devtoolsEnabled: true,
        vueDetected: true,
      }, '*')
      return
    }

    if (detectRemainingTries > 0) {
      detectRemainingTries--
      setTimeout(() => {
        runDetect()
      }, delay)
      delay *= 5
    }
  }

  setTimeout(() => {
    runDetect()
  }, 100)
}

// inject the hook
if (document instanceof HTMLDocument) {
  detect()
  installToast()
}
