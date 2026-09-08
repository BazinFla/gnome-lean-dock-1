// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

/*
 * Pinned Apps in AppGrid Manager
 *
 * Keeps favorite/pinned applications visible in the AppGrid and inside folders
 * while they also remain in the Dock.
 *
 * Based on the architecture from pinned-apps-in-appgrid@brunosilva.io.
 */

import GObject from 'gi://GObject';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as AppFavorites from 'resource:///org/gnome/shell/ui/appFavorites.js';
import * as DashModule from 'resource:///org/gnome/shell/ui/dash.js';
import * as DND from 'resource:///org/gnome/shell/ui/dnd.js';
import * as AppDisplay from 'resource:///org/gnome/shell/ui/appDisplay.js';
import * as ExtensionModule from 'resource:///org/gnome/shell/extensions/extension.js';

import { GlobalSignalsHandler } from './utils.js';

const DashToPanelIconGTypeName = 'Gjs_dash-to-panel_jderose9_github_com_appIcons_TaskbarAppIcon';

/**
 * Creates a Proxy around the AppFavorites singleton that intercepts isFavorite()
 * to always return false, allowing pinned apps to be loaded into the AppGrid
 * and folders during _redisplay().
 */
function createDummyAppFavorites() {
    const appFavorites = AppFavorites.getAppFavorites();

    return new Proxy(appFavorites, {
        get(target, prop, receiver) {
            if (prop === 'isFavorite') {
                return () => false;
            }

            const value = Reflect.get(target, prop, receiver);
            return typeof value === 'function' ? value.bind(target) : value;
        },
    });
}

/**
 * BaseAppViewMod - Makes favorites render in the AppGrid and folder views.
 */
class BaseAppViewMod {
    constructor(appDisplay) {
        this._appDisplay = appDisplay;
        this._dummyAppFavorites = createDummyAppFavorites();
        this._injectionManager = new ExtensionModule.InjectionManager();

        this._injectionManager.overrideMethod(
            AppDisplay.FolderView.prototype,
            '_redisplay',
            this._createFolderRedisplay.bind(this)
        );
        this._injectionManager.overrideMethod(
            AppDisplay.AppDisplay.prototype,
            '_redisplay',
            this._createRedisplay.bind(this)
        );

        if (this._appDisplay && typeof this._appDisplay._redisplay === 'function') {
            this._appDisplay._redisplay();
        }
    }

    clear() {
        this._dummyAppFavorites = AppFavorites.getAppFavorites();
        if (this._appDisplay && typeof this._appDisplay._redisplay === 'function') {
            this._appDisplay._redisplay();
        }
        this._injectionManager.clear();
    }

    _createRedisplay(originalMethod) {
        const mod = this;

        return function () {
            this._appFavorites = mod._dummyAppFavorites;
            originalMethod.call(this);

            if (this._folderIcons) {
                this._folderIcons.forEach(folderIcon => {
                    if (folderIcon?.icon && typeof folderIcon.icon.update === 'function') {
                        folderIcon.icon.update();
                    }
                });
            }
        };
    }

    _createFolderRedisplay(originalMethod) {
        const mod = this;

        return function () {
            this._appFavorites = mod._dummyAppFavorites;
            originalMethod.call(this);
        };
    }
}

/**
 * AppDisplayMod - Unpins an app when its dock/dash icon is dropped onto the AppGrid.
 */
class AppDisplayMod {
    constructor(appDisplay) {
        this._appDisplay = appDisplay;
        this._appFavorites = AppFavorites.getAppFavorites();
        this._injectionManager = new ExtensionModule.InjectionManager();

        if (this._appDisplay) {
            this._injectionManager.overrideMethod(
                this._appDisplay,
                'acceptDrop',
                this._createAcceptDrop.bind(this)
            );
        }
    }

    clear() {
        this._injectionManager.clear();
    }

    _isDashIcon(source) {
        if (!source) return false;
        return (
            source instanceof DashModule.DashIcon ||
            source?.constructor?.name === 'DockAppIcon' ||
            GObject.type_name(source) === DashToPanelIconGTypeName
        );
    }

    _createAcceptDrop(originalMethod) {
        const mod = this;
        const appFavorites = this._appFavorites;

        return function (source) {
            if (mod._isDashIcon(source)) {
                const id = source?.id || source?.app?.get_id();
                if (id && appFavorites.isFavorite(id)) {
                    appFavorites.removeFavorite(id);
                }
                return DND.DragDropResult.SUCCESS;
            }

            return originalMethod.call(this, source);
        };
    }
}

/**
 * DashMod - Prevents duplicate favorite additions when dragging an already-favorited
 * icon from the AppGrid onto the Dash/Dock.
 */
class DashMod {
    constructor() {
        this._appFavorites = AppFavorites.getAppFavorites();
        this._injectionManager = new ExtensionModule.InjectionManager();

        this._injectionManager.overrideMethod(
            DashModule.Dash,
            'getAppFromSource',
            this._createGetAppFromSource.bind(this)
        );
    }

    clear() {
        this._injectionManager.clear();
    }

    _createGetAppFromSource(originalMethod) {
        const appFavorites = this._appFavorites;

        return function (source) {
            if (source instanceof DashModule.DashIcon || source?.constructor?.name === 'DockAppIcon') {
                return source.app;
            }

            if (source instanceof AppDisplay.AppIcon) {
                if (source.app && appFavorites.isFavorite(source.app.get_id())) {
                    return null;
                }
                return source.app;
            }

            return originalMethod.call(this, source);
        };
    }
}

/**
 * DockVisibilityMod - Ensures auto-hide docks stay visible during drag operations in overview.
 */
class DockVisibilityMod {
    constructor() {
        this._changed = [];
        this._overviewIds = [];

        if (Main.overview) {
            this._overviewIds = [
                Main.overview.connect('item-drag-begin', this._onDragBegin.bind(this)),
                Main.overview.connect('item-drag-end', this._onDragEnd.bind(this)),
                Main.overview.connect('item-drag-cancelled', this._onDragEnd.bind(this)),
            ];
        }
    }

    clear() {
        if (Main.overview && this._overviewIds.length > 0) {
            this._overviewIds.forEach(id => Main.overview.disconnect(id));
        }
        this._overviewIds = [];
        this._changed = [];
    }

    _dockDashes() {
        const candidates = [Main.overview?.dash, Main.overview?._overview?.controls?.dash];
        const seen = new Set();
        return candidates.filter(dash => {
            if (!dash || seen.has(dash) || typeof dash._requireVisibility !== 'function') {
                return false;
            }
            seen.add(dash);
            return true;
        });
    }

    _onDragBegin() {
        this._onDragEnd();

        for (const dash of this._dockDashes()) {
            this._changed.push([dash, dash.requiresVisibility]);
            dash.requiresVisibility = true;
        }
    }

    _onDragEnd() {
        for (const [dash, previous] of this._changed) {
            try {
                dash.requiresVisibility = previous;
            } catch {
                // Ignore if actor was destroyed
            }
        }
        this._changed = [];
    }
}

/**
 * PinnedAppsManager - Coordinates the pinned apps in AppGrid mods and reacts to setting changes.
 */
export class PinnedAppsManager {
    constructor(settings) {
        this.settings = settings;
        this._enabled = false;
        this._mods = [];
        this._appDisplay = null;
        this._signals = new GlobalSignalsHandler();

        this._signals.add([
            this.settings, 'changed::keep-pinned-apps-in-grid', () => this._syncState()
        ]);

        if (Main.layoutManager?._startingUp) {
            this._signals.add([
                Main.layoutManager, 'startup-complete', () => {
                    this._syncState();
                }
            ]);
        }

        if (Main.overview) {
            this._signals.add([
                Main.overview, 'showing', () => {
                    if (this.settings?.get_boolean('keep-pinned-apps-in-grid') && !this._enabled) {
                        this._syncState();
                    }
                }
            ]);
        }

        this._syncState();
    }

    _getAppDisplay() {
        return Main.overview?._overview?.controls?.appDisplay ||
            Main.overview?.overview?.controls?.appDisplay ||
            null;
    }

    _syncState() {
        if (!this.settings) return;

        const shouldEnable = this.settings.get_boolean('keep-pinned-apps-in-grid');
        if (shouldEnable && !this._enabled) {
            this._enableMods();
        } else if (!shouldEnable && this._enabled) {
            this._disableMods();
        }
    }

    _enableMods() {
        if (this._enabled) return;

        const appDisplay = this._getAppDisplay();
        if (!appDisplay) {
            return;
        }

        this._appDisplay = appDisplay;
        this._mods = [];

        try {
            this._mods.push(new BaseAppViewMod(this._appDisplay));
            this._mods.push(new AppDisplayMod(this._appDisplay));
            this._mods.push(new DashMod());
            this._mods.push(new DockVisibilityMod());
            this._enabled = true;
        } catch (e) {
            console.error('[gld-1@bazinfla.github.com] PinnedAppsManager: failed to enable, rolling back', e);
            this._disableMods();
        }
    }

    _disableMods() {
        if (!this._enabled && this._mods.length === 0) return;

        this._mods.reverse().forEach(mod => {
            try {
                mod.clear();
            } catch (e) {
                console.error('[gld-1@bazinfla.github.com] PinnedAppsManager: error clearing mod', e);
            }
        });
        this._mods = [];
        this._appDisplay = null;
        this._enabled = false;
    }

    destroy() {
        this._disableMods();
        this._signals?.destroy();
        this._signals = null;
        this.settings = null;
    }
}
