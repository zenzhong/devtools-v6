# Frequently Asked Questions

## How to use the devtools in IE/Safari or any other browser?

In case your browser doesn't have our browser extension available, we made a standalone Vue devtools application.
[Get it now!](./installation.md#standalone)

## When opening an HTML file directly

Fixing "Download the Vue Devtools for a better development experience" console message when working locally over `file://` protocol:
- Google Chrome: Right click on vue-devtools icon and click "Manage Extensions" then search for vue-devtools on the extensions list. Check the "Allow access to file URLs" box.

## The Vue devtools don't show up

Here are some troubleshooting steps to help you if you don't the Vue devtools in your browser:

- Check if you have the extension [installed](./installation.md).
- This Pro edition has enhanced production detection, but some heavily optimized sites may still not be detected.
- Try closing the devtools pane, refreshing the page and opening the devtools pane again.
- Try restarting the browser or the computer.
- If you have multiple versions of the Vue devtools installed, it's recommended to disable/remove the others.
- Try disabling other devtools extensions like React devtools.
- Look for errors in the browser Console.
- Update your project dependencies.
- Even if the Vue logo in the toolbar is gray and says "Vue not detected", open your browser devtools and check if the Vue tab is showing up anyway.

## The data isn't updating in the component inspector

Make sure your data is used somewhere in your templates. Vue uses a lazy reactivity system for performance reasons, so the devtools could read some component data but Vue might not trigger updates on it as you would expect.

You can also click on the `Force refresh` button at the top of the devtools to do a manual refresh of the component data.

## A weird gray overlay is displayed on my page when I move the mouse in the timeline

By default, the devtools will try to take screenshots of your application when something happens on the Timeline. But it can fail for various reasons (such as undocking the devtools pane on Chrome). In that case, you can turn the screenshots off by opening the 'More' menu on the top right of the devtools (three vertical dots).

## Some package is polluting my devtools

The new Vue devtools feature a powerful public API so that package authors can integrate with the devtools (for example vuex or pinia). Since great power comes with great responsibility, you can disable specific permissions of a plugin, or even turn it off entirely, by going to the 'More' menu (three vertical dots on the top right), and then 'Devtools plugins...'.

## I can't open a component in my editor

This feature needs some setup in your project to work correctly. See [here](./open-in-editor.md) for more information.

## Something is broken in the new devtools

See [installing the previous version](./installation.md#legacy) for more information.

## How to search component data (props, data, setup state, computed)?

By default, the component tree search only matches component names for better performance. To enable deep data search:

1. Click the **⋮** (more options) button in the component tree toolbar
2. Turn on the **Search component data** switch
3. Now your search will also match props, data, setup state, and computed field values
4. Matched components will show the full data path in a tag (e.g. `$data.store.state.user.name`)

::: tip
Keep this option off when you don't need it — searching through all component data can be slower on large applications.
:::
