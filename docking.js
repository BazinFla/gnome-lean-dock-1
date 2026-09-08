// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';
import * as DND from 'resource:///org/gnome/shell/ui/dnd.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PointerWatcher from 'resource:///org/gnome/shell/ui/pointerWatcher.js';

import {DockDash} from './dash.js';
import {Intellihide} from './intellihide.js';
import {PinnedAppsManager} from './pinnedApps.js';
import {GlobalSignalsHandler, Position, getMonitorGeometry} from './utils.js';

export const DockBox = GObject.registerClass(
class DockBox extends St.Widget {
    _init(dockManager, monitorIndex) {
        super._init({
            name: 'gld1Container',
            reactive: true,
            track_hover: true,
        });

        this._dockManager = dockManager;
        this._monitorIndex = monitorIndex;
        this.settings = dockManager.settings;
        this._signals = new GlobalSignalsHandler();

        this._isShown = true;
        this._edgeDwelling = false;
        this._hasOpenMenu = false;
        this._hideTimestamp = 0;
        this._hideTimeoutId = 0;
        this._showTimeoutId = 0;
        this._updateLayoutId = 0;

        // Create Dash
        this._dash = new DockDash(this);
        this.add_child(this._dash);

        // Intellihide
        this._intellihide = new Intellihide(this._monitorIndex);

        // Add to LayoutManager
        Main.layoutManager.addChrome(this, {
            affectsStruts: false,
            trackFullscreen: true,
        });

        // Pointer watcher for reliable edge dwelling
        const pointerWatcher = PointerWatcher.getPointerWatcher();
        this._dockWatch = pointerWatcher.addWatch(50, (x, y) => this._checkPointerPosition(x, y));
        this._itemDragging = false;
        this._dragOverDock = false;
        this._dragInactivityTimeoutId = 0;

        this._globalDragMonitor = {
            dragMotion: (dragEvent) => {
                const target = dragEvent.targetActor;
                const isOver = target && (this.contains(target) || (this._edgeTrigger && this._edgeTrigger.contains(target)));
                if (isOver !== this._dragOverDock) {
                    this._dragOverDock = isOver;
                    this._updateVisibility(true);
                }

                if (this._dash) {
                    this._dash._clearAllSpringTimeouts(target);
                }

                if (this._dragInactivityTimeoutId > 0) {
                    GLib.source_remove(this._dragInactivityTimeoutId);
                }
                this._dragInactivityTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 700, () => {
                    this._dragInactivityTimeoutId = 0;
                    if (this._dragOverDock) {
                        this._dragOverDock = false;
                        this._updateVisibility(true);
                    }
                    if (this._dash) {
                        this._dash._clearAllSpringTimeouts(null);
                    }
                    return GLib.SOURCE_REMOVE;
                });

                return DND.DragMotionResult.CONTINUE;
            },
        };
        DND.addDragMonitor(this._globalDragMonitor);

        this._signals.add(
            [this, 'scroll-event', (_actor, event) => {
                if (this._dash) {
                    return this._dash.handleScrollEvent(event);
                }
                return Clutter.EVENT_PROPAGATE;
            }],
            [this, 'notify::hover', () => this._onHoverChanged()],
            [this._dash, 'menu-opened', () => this._onMenuOpened()],
            [this._dash, 'menu-closed', () => this._onMenuClosed()],
            [this._intellihide, 'status-changed', (_i, overlap) => this._onIntellihideChanged(overlap)],
            [Main.overview, 'showing', () => this._onOverviewShowing()],
            [Main.overview, 'hiding', () => this._onOverviewHiding()],
            [Main.overview, 'hidden', () => this._onOverviewHidden()],
            [Main.overview, 'item-drag-begin', () => {
                this._itemDragging = true;
                this._showDock(true);
            }],
            [Main.overview, 'item-drag-end', () => {
                this._itemDragging = false;
                this._updateVisibility(true);
            }],
            [Main.overview, 'item-drag-cancelled', () => {
                this._itemDragging = false;
                this._updateVisibility(true);
            }],
            [this.settings, 'changed::dock-position', () => this.queueUpdateLayout()],
            [this.settings, 'changed::extend-height', () => this.queueUpdateLayout()],
            [this.settings, 'changed::dock-margin', () => this.queueUpdateLayout()],
            [this.settings, 'changed::background-opacity', () => this._updateOpacity()],
            [this.settings, 'changed::dash-max-icon-size', () => this.queueUpdateLayout()],
            [this.settings, 'changed::show-show-apps-button', () => this.queueUpdateLayout()],
            [this._dash, 'notify::size', () => this.queueUpdateLayout()],
            [global.display, 'workareas-changed', () => this.queueUpdateLayout()]
        );

        if (Main.panel) {
            this._signals.add([Main.panel, 'notify::height', () => this.queueUpdateLayout()]);
        }

        this._updateLayout();
        this._updateOpacity();
        this._updateVisibility(false);

        // Queue a layout update on idle to ensure deferred dash icons are fully measured
        this.queueUpdateLayout();
    }

    queueUpdateLayout() {
        if (this._updateLayoutId > 0) return;
        this._updateLayoutId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._updateLayoutId = 0;
            this._updateLayout();
            const controls = Main.overview._overview?.controls;
            controls?.layout_manager?.layout_changed?.();
            return GLib.SOURCE_REMOVE;
        });
    }

    _updateOpacity() {
        if (!this._dash) return;
        const opacity = this.settings.get_double('background-opacity');
        this._dash.set_style(`background-color: rgba(24, 24, 24, ${opacity});`);
    }

    _updateLayout() {
        if (!this._dash || !this._signals || !this.get_stage?.()) return;
        const monitor = getMonitorGeometry(this._monitorIndex);
        if (!monitor) return;

        const pos = this.settings.get_enum('dock-position');
        const extend = this.settings.get_boolean('extend-height');

        const natW = typeof this._dash.getNaturalWidth === 'function'
            ? this._dash.getNaturalWidth()
            : this._dash.get_preferred_width(-1)[1];
        const natH = typeof this._dash.getNaturalHeight === 'function'
            ? this._dash.getNaturalHeight()
            : this._dash.get_preferred_height(-1)[1];

        const isVertical = (pos === Position.LEFT || pos === Position.RIGHT);

        const isPrimary = (this._monitorIndex === Main.layoutManager.primaryIndex ||
                           (Main.layoutManager.primaryMonitor && this._monitorIndex === Main.layoutManager.primaryMonitor.index));
        const panelHeight = (isPrimary && Main.panel && Main.panel.visible) ? Main.panel.height : 0;

        const availX = monitor.x;
        const availY = monitor.y + panelHeight;
        const availW = monitor.width;
        const availH = Math.max(monitor.height - panelHeight, 0);

        const iconSize = this.settings.get_int('dash-max-icon-size') || 48;
        const minDim = Math.max(iconSize, 16);
        const dashW = Math.max(natW || 0, minDim);
        const dashH = Math.max(natH || 0, minDim);

        const marginSetting = this.settings.get_int('dock-margin');
        const screenMargin = extend ? 0 : Math.max(marginSetting, 0);

        let boxX = availX;
        let boxY = availY;
        let boxW = availW;
        let boxH = availH;

        switch (pos) {
        case Position.BOTTOM:
            boxW = extend ? availW : Math.min(dashW, availW - (screenMargin * 2));
            boxH = extend ? dashH : Math.min(dashH, availH - (screenMargin * 2));
            boxX = extend ? availX : availX + Math.floor((availW - boxW) / 2);
            boxY = extend ? (monitor.y + monitor.height - boxH) : (monitor.y + monitor.height - boxH - screenMargin);
            break;
        case Position.TOP:
            boxW = extend ? availW : Math.min(dashW, availW - (screenMargin * 2));
            boxH = extend ? dashH : Math.min(dashH, availH - (screenMargin * 2));
            boxX = extend ? availX : availX + Math.floor((availW - boxW) / 2);
            boxY = extend ? availY : (availY + screenMargin);
            break;
        case Position.LEFT:
            boxW = extend ? dashW : Math.min(dashW, availW - (screenMargin * 2));
            boxH = extend ? availH : Math.min(dashH, availH - (screenMargin * 2));
            boxX = extend ? availX : (availX + screenMargin);
            boxY = extend ? availY : (availY + Math.floor((availH - boxH) / 2));
            break;
        case Position.RIGHT:
            boxW = extend ? dashW : Math.min(dashW, availW - (screenMargin * 2));
            boxH = extend ? availH : Math.min(dashH, availH - (screenMargin * 2));
            boxX = extend ? (availX + availW - boxW) : (availX + availW - boxW - screenMargin);
            boxY = extend ? availY : (availY + Math.floor((availH - boxH) / 2));
            break;
        }

        this.set_position(boxX, boxY);
        this.set_size(boxW, boxH);
        this._dash.set_position(0, 0);
        this._dash.set_size(boxW, boxH);

        this._intellihide.setTargetBox({
            x: boxX,
            y: boxY,
            width: boxW,
            height: boxH,
        });
    }

    _checkPointerPosition(x, y) {
        if (this._isShown) {
            this._edgeDwelling = false;
            this._clearShowTimer();
            return;
        }

        if (Main.overview.visibleTarget || Main.overview.visible) {
            return;
        }

        // Cooldown period after hiding to prevent immediate bounce-back
        if (this._hideTimestamp > 0 && (GLib.get_monotonic_time() - this._hideTimestamp < 300 * 1000)) {
            return;
        }

        const monitor = getMonitorGeometry(this._monitorIndex);
        if (!monitor) return;

        const pos = this.settings.get_enum('dock-position');
        const extend = this.settings.get_boolean('extend-height');
        const [boxX, boxY] = this.get_position();
        const [boxW, boxH] = this.get_size();

        let atEdge = false;
        const leeway = 20;

        switch (pos) {
        case Position.BOTTOM: {
            const minX = extend ? monitor.x : Math.max(monitor.x, boxX - leeway);
            const maxX = extend ? monitor.x + monitor.width : Math.min(monitor.x + monitor.width, boxX + boxW + leeway);
            atEdge = (y >= monitor.y + monitor.height - 1) && (x >= minX) && (x <= maxX);
            break;
        }
        case Position.TOP: {
            const minX = extend ? monitor.x : Math.max(monitor.x, boxX - leeway);
            const maxX = extend ? monitor.x + monitor.width : Math.min(monitor.x + monitor.width, boxX + boxW + leeway);
            atEdge = (y <= monitor.y) && (x >= minX) && (x <= maxX);
            break;
        }
        case Position.LEFT: {
            const minY = extend ? monitor.y : Math.max(monitor.y, boxY - leeway);
            const maxY = extend ? monitor.y + monitor.height : Math.min(monitor.y + monitor.height, boxY + boxH + leeway);
            atEdge = (x <= monitor.x) && (y >= minY) && (y <= maxY);
            break;
        }
        case Position.RIGHT: {
            const minY = extend ? monitor.y : Math.max(monitor.y, boxY - leeway);
            const maxY = extend ? monitor.y + monitor.height : Math.min(monitor.y + monitor.height, boxY + boxH + leeway);
            atEdge = (x >= monitor.x + monitor.width - 1) && (y >= minY) && (y <= maxY);
            break;
        }
        }

        if (atEdge) {
            if (!this._edgeDwelling && this._showTimeoutId === 0) {
                this._edgeDwelling = true;
                const showDelay = Math.max(this.settings.get_double('show-delay') * 1000, 50);
                this._showTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, showDelay, () => {
                    this._showTimeoutId = 0;
                    if (this._edgeDwelling) {
                        this._showDock(true);
                    }
                    return GLib.SOURCE_REMOVE;
                });
            }
        } else if (this._edgeDwelling) {
            this._edgeDwelling = false;
            this._clearShowTimer();
        }
    }

    _onMenuOpened() {
        this._hasOpenMenu = true;
        this._clearHideTimer();
        this._clearShowTimer();
        this._showDock(true);
    }

    _onMenuClosed() {
        this._hasOpenMenu = false;
        this.sync_hover();
        this._onHoverChanged();
    }

    _onHoverChanged() {
        if (this._hasOpenMenu) {
            this._clearHideTimer();
            this._showDock(true);
            return;
        }

        if (this.hover) {
            this._clearHideTimer();
            this._showDock(true);
        } else {
            this._clearShowTimer();
            if (this._isShown) {
                if (!this._shouldBeVisible()) {
                    const hideDelay = this.settings.get_double('hide-delay') * 1000;
                    this._hideTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, hideDelay, () => {
                        this._hideTimeoutId = 0;
                        this._updateVisibility(true);
                        return GLib.SOURCE_REMOVE;
                    });
                }
            }
        }
    }

    _clearHideTimer() {
        if (this._hideTimeoutId > 0) {
            GLib.source_remove(this._hideTimeoutId);
            this._hideTimeoutId = 0;
        }
    }

    _clearShowTimer() {
        if (this._showTimeoutId > 0) {
            GLib.source_remove(this._showTimeoutId);
            this._showTimeoutId = 0;
        }
    }

    _onIntellihideChanged(_hasOverlap) {
        if (this._hasOpenMenu) return;
        this._updateVisibility(true);
    }

    _onOverviewShowing() {
        this._showDock(true);
    }

    _onOverviewHiding() {
        this._updateVisibility(true);
    }

    _onOverviewHidden() {
        this._updateVisibility(true);
    }

    _shouldBeVisible() {
        if (Main.overview.visibleTarget) {
            return true;
        }

        if (this._itemDragging || this._dragOverDock) {
            return true;
        }

        if (this._hasOpenMenu) {
            return true;
        }

        if (this.hover) {
            return true;
        }

        // Dock is visible on desktop, hides only when windows overlap
        return !this._intellihide.hasOverlap;
    }

    _updateVisibility(animate) {
        if (this._shouldBeVisible()) {
            this._showDock(animate);
        } else {
            this._hideDock(animate);
        }
    }

    _showDock(animate) {
        if (this._isShown) return;
        this._isShown = true;
        this._edgeDwelling = false;

        this._clearHideTimer();
        this._clearShowTimer();

        this.reactive = true;

        const duration = animate ? (this.settings.get_double('animation-time') * 1000) : 0;
        this._dash.remove_all_transitions();
        this._dash.ease({
            translation_x: 0,
            translation_y: 0,
            opacity: 255,
            duration,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    _hideDock(animate) {
        if (this._hasOpenMenu) return;
        if (!this._isShown) return;
        this._isShown = false;
        this._edgeDwelling = false;
        this._hideTimestamp = GLib.get_monotonic_time();

        this._clearHideTimer();
        this._clearShowTimer();

        this.reactive = false;

        const pos = this.settings.get_enum('dock-position');
        const duration = animate ? (this.settings.get_double('animation-time') * 1000) : 0;
        const hideOffset = Math.max(this.height || 64, this.width || 64) + 20;

        let tx = 0;
        let ty = 0;

        switch (pos) {
        case Position.BOTTOM:
            ty = hideOffset;
            break;
        case Position.TOP:
            ty = -hideOffset;
            break;
        case Position.LEFT:
            tx = -hideOffset;
            break;
        case Position.RIGHT:
            tx = hideOffset;
            break;
        }

        this._dash.remove_all_transitions();
        this._dash.ease({
            translation_x: tx,
            translation_y: ty,
            opacity: 0,
            duration,
            mode: Clutter.AnimationMode.EASE_IN_QUAD,
        });
    }

    destroy() {
        if (this._updateLayoutId > 0) {
            GLib.source_remove(this._updateLayoutId);
            this._updateLayoutId = 0;
        }
        if (this._dragInactivityTimeoutId > 0) {
            GLib.source_remove(this._dragInactivityTimeoutId);
            this._dragInactivityTimeoutId = 0;
        }
        this._clearHideTimer();
        this._clearShowTimer();
        if (this._dockWatch) {
            if (typeof this._dockWatch.remove === 'function') {
                this._dockWatch.remove();
            } else {
                PointerWatcher.getPointerWatcher()._removeWatch(this._dockWatch);
            }
            this._dockWatch = null;
        }
        if (this._globalDragMonitor) {
            DND.removeDragMonitor(this._globalDragMonitor);
            this._globalDragMonitor = null;
        }
        this._signals?.destroy();
        this._signals = null;
        this._intellihide?.destroy();
        this._intellihide = null;
        if (this._dash) {
            this._dash.destroy();
            this._dash = null;
        }
        Main.layoutManager.removeChrome(this);
        super.destroy();
    }
});

export class DockManager {
    constructor(extension) {
        this.extension = extension;
        this.settings = extension.getSettings();
        this._docks = [];
        this._signals = new GlobalSignalsHandler();
        this._stockDash = null;
        this._stockDashSignals = null;
        this._pinnedAppsManager = new PinnedAppsManager(this.settings);

        this._prepareOverviewDash();

        this._signals.add(
            [Main.layoutManager, 'monitors-changed', () => this._rebuildDocks()],
            [this.settings, 'changed::multi-monitor', () => this._rebuildDocks()],
            [this.settings, 'changed::preferred-monitor', () => this._rebuildDocks()],
            [this.settings, 'changed::dock-position', () => this._notifyOverviewLayout()],
            [this.settings, 'changed::dash-max-icon-size', () => this._notifyOverviewLayout()],
            [this.settings, 'changed::dock-margin', () => this._notifyOverviewLayout()]
        );

        if (Main.layoutManager._startingUp) {
            this._signals.add([
                Main.layoutManager, 'startup-complete', () => {
                    for (const dock of this._docks) {
                        dock.queueUpdateLayout();
                    }
                    this._notifyOverviewLayout();
                }
            ]);
        }

        this._rebuildDocks();
    }

    _notifyOverviewLayout() {
        const controls = Main.overview._overview?.controls;
        controls?.layout_manager?.layout_changed?.();
    }

    getPrimaryDock() {
        if (!this._docks || this._docks.length === 0) return null;
        const pref = this.settings ? this.settings.get_int('preferred-monitor') : -1;
        const primaryIdx = (pref >= 0 && pref < Main.layoutManager.monitors.length)
            ? pref
            : Main.layoutManager.primaryIndex;
        return this._docks.find(d => d._monitorIndex === primaryIdx) || this._docks[0] || null;
    }

    _prepareOverviewDash() {
        const controls = Main.overview._overview?.controls;
        const stockDash = controls?.dash || Main.overview.dash;
        if (!stockDash) return;

        this._stockDash = stockDash;
        this._origStockDashHeight = stockDash.height;
        this._origStockDashGetPreferredHeight = stockDash.get_preferred_height;
        this._origStockDashGetPreferredWidth = stockDash.get_preferred_width;
        this._origStockDashSetMaxSize = stockDash.setMaxSize;
        this._origStockDashReactive = stockDash.reactive;

        // Keep stockDash visible in Clutter tree so ControlsManagerLayout queries its preferred size
        // and reserves layout space for the dock in WINDOW_PICKER and APP_GRID.
        stockDash.show();
        stockDash.opacity = 0;
        stockDash.reactive = false;

        stockDash.setMaxSize = () => {};

        stockDash.get_preferred_height = (forWidth) => {
            const dock = this.getPrimaryDock();
            if (!dock || !this.settings) return [0, 0];
            const pos = this.settings.get_enum('dock-position');
            const iconSize = this.settings.get_int('dash-max-icon-size') || 48;
            const margin = this.settings.get_boolean('extend-height') ? 0 : this.settings.get_int('dock-margin');
            if (pos === Position.BOTTOM) {
                const monitor = getMonitorGeometry(dock._monitorIndex);
                const maxH = monitor ? monitor.height : 1080;
                const natH = dock._dash ? (typeof dock._dash.getNaturalHeight === 'function' ? dock._dash.getNaturalHeight() : dock._dash.get_preferred_height(forWidth)[1]) : iconSize;
                const h = Math.min((natH || iconSize) + margin, maxH);
                return [h, h];
            }
            return [0, 0];
        };

        stockDash.get_preferred_width = (forHeight) => {
            const dock = this.getPrimaryDock();
            if (!dock || !this.settings) return [0, 0];
            const pos = this.settings.get_enum('dock-position');
            const iconSize = this.settings.get_int('dash-max-icon-size') || 48;
            if (pos === Position.BOTTOM) {
                const monitor = getMonitorGeometry(dock._monitorIndex);
                const maxW = monitor ? monitor.width : 1920;
                const natW = dock._dash ? (typeof dock._dash.getNaturalWidth === 'function' ? dock._dash.getNaturalWidth() : dock._dash.get_preferred_width(forHeight)[1]) : iconSize;
                const w = Math.min(natW || iconSize, maxW);
                return [w, w];
            }
            return [0, 0];
        };

        this._stockDashSignals = new GlobalSignalsHandler();
        this._stockDashSignals.add(
            [stockDash, 'notify::opacity', () => {
                if (this._stockDash && this._stockDash.opacity !== 0) {
                    this._stockDash.opacity = 0;
                }
            }],
            [stockDash, 'notify::reactive', () => {
                if (this._stockDash && this._stockDash.reactive) {
                    this._stockDash.reactive = false;
                }
            }],
            [stockDash, 'notify::visible', () => {
                if (this._stockDash && !this._stockDash.visible) {
                    this._stockDash.show();
                }
            }]
        );

        this._notifyOverviewLayout();
    }

    _restoreOverviewDash() {
        if (!this._stockDash) return;

        this._stockDashSignals?.destroy();
        this._stockDashSignals = null;

        if (this._origStockDashGetPreferredHeight) {
            this._stockDash.get_preferred_height = this._origStockDashGetPreferredHeight;
        }
        if (this._origStockDashGetPreferredWidth) {
            this._stockDash.get_preferred_width = this._origStockDashGetPreferredWidth;
        }
        if (this._origStockDashSetMaxSize) {
            this._stockDash.setMaxSize = this._origStockDashSetMaxSize;
        }

        this._stockDash.set_height(-1);
        this._stockDash.opacity = 255;
        this._stockDash.reactive = (this._origStockDashReactive !== undefined) ? this._origStockDashReactive : true;
        this._stockDash.show();

        this._notifyOverviewLayout();

        this._stockDash = null;
    }

    _rebuildDocks() {
        this._destroyDocks();

        const multi = this.settings.get_boolean('multi-monitor');
        const pref = this.settings.get_int('preferred-monitor');

        if (multi) {
            for (let i = 0; i < Main.layoutManager.monitors.length; i++) {
                this._docks.push(new DockBox(this, i));
            }
        } else {
            const index = (pref >= 0 && pref < Main.layoutManager.monitors.length) ?
                pref : Main.layoutManager.primaryIndex;
            this._docks.push(new DockBox(this, index));
        }

        this._notifyOverviewLayout();
    }

    _destroyDocks() {
        for (const dock of this._docks) {
            dock.destroy();
        }
        this._docks = [];
    }

    destroy() {
        this._pinnedAppsManager?.destroy();
        this._pinnedAppsManager = null;
        this._restoreOverviewDash();
        this._destroyDocks();
        this._signals.destroy();
        this.settings = null;
        this.extension = null;
    }
}

