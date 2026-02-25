import { installToast } from '@back/toast'
import { isFirefox } from '@vue-devtools/shared-utils'

window.addEventListener('message', (e) => {
  if (e.source === window && e.data.vueDetected) {
    chrome.runtime.sendMessage(e.data)
  }
})

function detect(win) {
  let delay = 1000
  let detectRemainingTries = 10

  function runDetect() {
    // Method 1: Check Nuxt
    const nuxtDetected = !!(window.__NUXT__ || window.$nuxt)

    if (nuxtDetected) {
      win.postMessage({
        devtoolsEnabled: true,
        vueDetected: true,
        nuxtDetected: true,
      }, '*')

      return
    }

    // Method 2: Check  Vue 3
    const vueDetected = !!(window.__VUE__)
    if (vueDetected) {
      win.postMessage({
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
      win.postMessage({
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
  installScript(detect)
  installScript(installToast)
}

function installScript(fn) {
  const source = `;(${fn.toString()})(window)`

  if (isFirefox) {
    // eslint-disable-next-line no-eval
    window.eval(source) // in Firefox, this evaluates on the content window
  }
  else {
    const script = document.createElement('script')
    script.textContent = source
    document.documentElement.appendChild(script)
    script.parentNode.removeChild(script)
  }
}
