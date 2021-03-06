/* See license.txt for terms of usage */

// ********************************************************************************************* //
// Constants

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cu = Components.utils;

// List of firebug modules that must be loaded at startup and unloaded on shutdown.
// !important every new module loaded with Cu.import must be added here
var FIREBUG_MODULES = [
    "resource://firebug/debuggerHalter.js",
    "resource://firebug/fbtrace.js",
    "resource://firebug/firebug-http-observer.js",
    "resource://firebug/firebug-service.js",
    "resource://firebug/firebug-trace-service.js",
    "resource://firebug/gcli.js",
    "resource://firebug/loader.js",
    "resource://firebug/locale.js",
    "resource://firebug/mini-require.js",
    "resource://firebug/observer-service.js",
    "resource://firebug/prefLoader.js",
    "resource://firebug/require-debug.js",
    "resource://firebug/require.js",
    "resource://firebug/storageService.js"
];

Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://gre/modules/Services.jsm");

// ********************************************************************************************* //
// Bootstrap API

function install(params, reason)
{
}

function uninstall(params, reason)
{
}

function startup(params, reason)
{
    // Register the resource:// mappings
    var res = Services.io.getProtocolHandler("resource").QueryInterface(Ci.nsIResProtocolHandler);
    var resourceURI = Services.io.newURI(__SCRIPT_URI_SPEC__ + "/../modules/", null, null);
    res.setSubstitution("firebug", resourceURI);
    res.setSubstitution("moduleloader", resourceURI);

    // Add our chrome registration. not needed for 10+
    Components.manager.addBootstrappedManifestLocation(params.installPath);

    Cu.import("resource://firebug/prefLoader.js");

    // Register default preferences
    PrefLoader.loadDefaultPrefs(params.installPath, "firebug.js");
    PrefLoader.loadDefaultPrefs(params.installPath, "cookies.js");
    PrefLoader.loadDefaultPrefs(params.installPath, "tracingConsole.js");

    // Load the overlay manager
    Cu.import("resource://firebug/loader.js");

    //register extensions
    FirebugLoader.startup();

    // Load Firebug into all existing browser windows.
    var enumerator = Services.wm.getEnumerator("navigator:browser");
    while (enumerator.hasMoreElements())
        FirebugLoader.loadIntoWindow(enumerator.getNext(), reason);

    // Listen for new windows, Firebug must be loaded into them too.
    Services.obs.addObserver(windowWatcher, "chrome-document-global-created", false);

    // GCLI commands
    Cu.import("resource://firebug/gcli.js");
    FirebugGCLICommands.startup();
}

function shutdown(params, reason)
{
    // Don't need to clean anything up if the application is shutting down
    if (reason == APP_SHUTDOWN)
        return;

    // Remove "new window" listener.
    Services.obs.removeObserver(windowWatcher, "chrome-document-global-created");

    // remove from all windows
    try
    {
        FirebugLoader.shutdown();
    }
    catch(e)
    {
        Cu.reportError(e);
    }

    // Unregister all GCLI commands
    FirebugGCLICommands.shutdown();

    // xxxHonza: I think this shouldn't be here (perhaps in firebug-service.js)
    // Shutdown Firebug's JSD debugger service.
    var fbs = Cu.import("resource://firebug/firebug-service.js", {}).fbs;
    fbs.disableDebugger();
    fbs.shutdown();

    // remove default preferences
    PrefLoader.clearDefaultPrefs();

    // Unload all Firebug modules added with Cu.import
    FIREBUG_MODULES.forEach(Cu.unload, Cu);

    // Remove our chrome registration. not needed for 10+
    Components.manager.removeBootstrappedManifestLocation(params.installPath);

    // Clear our resource registration
    var res = Services.io.getProtocolHandler("resource").QueryInterface(Ci.nsIResProtocolHandler);
    res.setSubstitution("firebug", null);
    res.setSubstitution("moduleloader", null);
}

// ********************************************************************************************* //
// Window Listener

var windowWatcher =
{
    QueryInterface: XPCOMUtils.generateQI([Ci.nsIObserver]),
    observe: function windowWatcher(win, topic, data)
    {
        // https://bugzil.la/795961 ?
        win.addEventListener("load", function onLoad(evt)
        { 
            // load listener not necessary once https://bugzil.la/800677 is fixed
            var win = evt.currentTarget;
            win.removeEventListener("load", onLoad, false);
            if (win.document.documentElement.getAttribute("windowtype") == "navigator:browser")
                FirebugLoader.loadIntoWindow(win);
        }, false);
    }
};

// ********************************************************************************************* //
