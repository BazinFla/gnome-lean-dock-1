// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Dash from 'resource:///org/gnome/shell/ui/dash.js';
import * as DND from 'resource:///org/gnome/shell/ui/dnd.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import { WindowPreviewMenu } from './windowPreview.js';
import { GlobalSignalsHandler, Position, ensureActorVisibleInScrollView } from './utils.js';

const ACCENT_COLORS = {
    blue: { standard: '#3584e4', focused: '#78aeed' },
    teal: { standard: '#2190a4', focused: '#5bc8af' },
    green: { standard: '#3a944a', focused: '#57e389' },
    yellow: { standard: '#c88800', focused: '#f8e45c' },
    orange: { standard: '#ed5b00', focused: '#ff7800' },
    red: { standard: '#e01b24', focused: '#f66151' },
    pink: { standard: '#d56199', focused: '#f08fc0' },
    purple: { standard: '#9141ac', focused: '#c061cb' },
    slate: { standard: '#6f8396', focused: '#99c1f1' },
    white: { standard: '#deddda', focused: '#ffffff' },
};

export const DockAppIcon = GObject.registerClass(
    class DockAppIcon extends Dash.DashIcon {
        _init(app, dock) {
            this._dock = dock;
            this._signals = new GlobalSignalsHandler();
            this._previewMenu = null;
            this._previewMenuManager = new PopupMenu.PopupMenuManager(this);
            this._runningDot = null;
            this._springTimeoutId = 0;
            this._springActivated = false;

            super._init(app);

            this.add_style_class_name('app-well-app');
            this.add_style_class_name('overview-tile');

            if (this._dot) {
                this._dot.hide();
                this._dot.opacity = 0;
                this._dot.set_size(0, 0);
                this._dot.reactive = false;
            }

            // Running indicators container
            this._runningContainer = new St.BoxLayout({
                style_class: 'gld1-running-container',
                reactive: false,
                x_expand: true,
                y_expand: true,
            });
            this._updateIndicatorAlignment();

            if (this._iconContainer) {
                this._iconContainer.add_child(this._runningContainer);
            } else {
                this.add_child(this._runningContainer);
            }

            if (this.app) {
                this._signals.add(
                    [this.app, 'windows-changed', () => this._updateRunningState()],
                    [this.app, 'notify::state', () => this._updateRunningState()]
                );
            }

            if (this._dock?.settings) {
                this._signals.add(
                    [this._dock.settings, 'changed::running-indicator-style', () => this._updateRunningState()],
                    [this._dock.settings, 'changed::running-indicator-color', () => this._updateRunningState()],
                    [this._dock.settings, 'changed::window-preview-style', () => {
                        this._previewMenu?.destroy();
                        this._previewMenu = null;
                    }],
                    [this._dock.settings, 'changed::window-preview-size', () => {
                        this._previewMenu?.destroy();
                        this._previewMenu = null;
                    }],
                    [this._dock.settings, 'changed::dock-position', () => {
                        this._updateIndicatorAlignment();
                        this._updateRunningState();
                        this._previewMenu?.destroy();
                        this._previewMenu = null;
                    }]
                );
            }

            try {
                this._desktopInterfaceSettings = new Gio.Settings({ schema_id: 'org.gnome.desktop.interface' });
                this._signals.add(
                    [this._desktopInterfaceSettings, 'changed::accent-color', () => this._updateRunningState()]
                );
            } catch (_) {
                this._desktopInterfaceSettings = null;
            }

            this._signals.add(
                [global.display, 'notify::focus-window', () => this._updateFocusState()]
            );

            this._updateRunningState();
            this._updateFocusState();
        }

        _ensureVisible() {
            const item = this.get_parent();
            const scrollView = this._dock?._dash?._scrollView;
            if (scrollView && item) {
                ensureActorVisibleInScrollView(scrollView, item);
            }
        }

        setIconSize(size) {
            if (!size || size <= 0) return;

            if (this.icon) {
                if (typeof this.icon.setIconSize === 'function') {
                    this.icon.setIconSize(size);
                }
                if (typeof this.icon.set_icon_size === 'function') {
                    this.icon.set_icon_size(size);
                }
                if (this.icon.iconSize !== undefined) {
                    this.icon.iconSize = size;
                }
                if (typeof this.icon.set_size === 'function') {
                    this.icon.set_size(size, size);
                }
            }

            if (this._iconContainer) {
                this._iconContainer.set_size(size, size);
            }

            this.queue_relayout();
        }

        _updateIndicatorAlignment() {
            if (!this._runningContainer) return;
            const pos = this._dock?.settings ? this._dock.settings.get_enum('dock-position') : Position.BOTTOM;
            switch (pos) {
            case Position.TOP:
                this._runningContainer.x_align = Clutter.ActorAlign.CENTER;
                this._runningContainer.y_align = Clutter.ActorAlign.START;
                this._runningContainer.vertical = false;
                break;
            case Position.LEFT:
                this._runningContainer.x_align = Clutter.ActorAlign.START;
                this._runningContainer.y_align = Clutter.ActorAlign.CENTER;
                this._runningContainer.vertical = true;
                break;
            case Position.RIGHT:
                this._runningContainer.x_align = Clutter.ActorAlign.END;
                this._runningContainer.y_align = Clutter.ActorAlign.CENTER;
                this._runningContainer.vertical = true;
                break;
            case Position.BOTTOM:
            default:
                this._runningContainer.x_align = Clutter.ActorAlign.CENTER;
                this._runningContainer.y_align = Clutter.ActorAlign.END;
                this._runningContainer.vertical = false;
                break;
            }
        }

        _getIndicatorPalette() {
            const settings = this._dock?.settings;
            const chosenColor = settings ? settings.get_string('running-indicator-color') : 'SYSTEM';

            let colorKey = 'blue';
            if (chosenColor === 'SYSTEM') {
                if (this._desktopInterfaceSettings) {
                    try {
                        colorKey = this._desktopInterfaceSettings.get_string('accent-color') || 'blue';
                    } catch (_) {
                        colorKey = 'blue';
                    }
                }
            } else {
                colorKey = chosenColor.toLowerCase();
            }

            return ACCENT_COLORS[colorKey] || ACCENT_COLORS.blue;
        }

        _updateRunningStyle() {
            if (this._dot) {
                this._dot.hide();
                this._dot.opacity = 0;
                this._dot.set_size(0, 0);
            }
            this._updateRunningState();
        }

        _updateRunningState() {
            if (this._dot) {
                this._dot.hide();
                this._dot.opacity = 0;
            }

            if (!this.app || !this._runningContainer) return;

            const windows = this.app.get_windows();
            const isRunning = windows.length > 0 || (this.app.state !== Shell.AppState.STOPPED);

            if (!isRunning) {
                this.remove_style_pseudo_class('running');
                this._runningContainer.destroy_all_children();
                this._runningContainer.hide();
                return;
            }

            this.add_style_pseudo_class('running');
            this._runningContainer.show();
            this._runningContainer.destroy_all_children();

            const settings = this._dock?.settings;
            const style = settings ? settings.get_string('running-indicator-style') : 'DOTS';
            const palette = this._getIndicatorPalette();

            const focusWindow = global.display.focus_window;
            const isFocused = focusWindow && windows.includes(focusWindow);

            switch (style) {
            case 'LINE': {
                const line = new St.Widget({
                    style_class: 'gld1-running-line',
                    style: `background-color: ${isFocused ? palette.focused : palette.standard};`,
                });
                if (isFocused) {
                    line.add_style_class_name('focused');
                }
                this._runningContainer.add_child(line);
                break;
            }
            case 'DASH': {
                const dash = new St.Widget({
                    style_class: 'gld1-running-dash',
                    style: `background-color: ${isFocused ? palette.focused : palette.standard};`,
                });
                if (isFocused) {
                    dash.add_style_class_name('focused');
                }
                this._runningContainer.add_child(dash);
                break;
            }
            case 'GLOW': {
                const glow = new St.Widget({
                    style_class: 'gld1-running-glow',
                    style: `background-color: ${isFocused ? palette.focused : palette.standard}; box-shadow: 0 0 ${isFocused ? '12px' : '8px'} ${isFocused ? palette.focused : palette.standard};`,
                });
                if (isFocused) {
                    glow.add_style_class_name('focused');
                }
                this._runningContainer.add_child(glow);
                break;
            }
            case 'DOTS':
            default: {
                const numDots = Math.max(1, Math.min(3, windows.length || 1));
                for (let i = 0; i < numDots; i++) {
                    const dot = new St.Widget({
                        style_class: 'gld1-running-dot',
                        style: `background-color: ${(isFocused && i === 0) ? palette.focused : palette.standard};`,
                    });
                    if (isFocused && (i === 0 || numDots === 1)) {
                        dot.add_style_class_name('focused');
                    }
                    this._runningContainer.add_child(dot);
                }
                break;
            }
            }
        }

        _updateFocusState() {
            if (!this.app) return;
            const focusWindow = global.display.focus_window;
            const isFocused = focusWindow && this.app.get_windows().includes(focusWindow);

            if (isFocused) {
                this.add_style_pseudo_class('focused');
            } else {
                this.remove_style_pseudo_class('focused');
            }

            this._updateRunningState();
        }

        _animateClick() {
            const target = this._iconContainer || this.icon || this;
            target.remove_all_transitions();
            target.set_pivot_point(0.5, 0.5);
            target.ease({
                scale_x: 0.82,
                scale_y: 0.82,
                duration: 90,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onComplete: () => {
                    target.ease({
                        scale_x: 1.0,
                        scale_y: 1.0,
                        duration: 180,
                        mode: Clutter.AnimationMode.EASE_OUT_BACK,
                    });
                },
            });
        }

        getDragActor() {
            const size = this._dock?._dash?.iconSize || (this._dock?.settings ? this._dock.settings.get_int('dash-max-icon-size') : 48) || 48;
            return this.app.create_icon_texture(size);
        }

        getDragActorSource() {
            return this.icon?.icon || this.icon || this._iconContainer || this;
        }

        vfunc_clicked(button) {
            if (button === Clutter.BUTTON_PRIMARY) {
                this.activate(button);
            } else if (button === Clutter.BUTTON_MIDDLE || button === 2) {
                this.activate(button);
            } else if (button === Clutter.BUTTON_SECONDARY || button === 3) {
                this.popupMenu();
            } else {
                this.activate(button);
            }
        }

        popupMenu(side = null) {
            let menuSide = side;
            if (menuSide === null || menuSide === undefined) {
                if (this._dock?.settings) {
                    const pos = this._dock.settings.get_enum('dock-position');
                    switch (pos) {
                        case Position.TOP:
                            menuSide = St.Side.TOP;
                            break;
                        case Position.BOTTOM:
                            menuSide = St.Side.BOTTOM;
                            break;
                        case Position.LEFT:
                            menuSide = St.Side.LEFT;
                            break;
                        case Position.RIGHT:
                            menuSide = St.Side.RIGHT;
                            break;
                    }
                }
            }
            if (menuSide === null || menuSide === undefined) {
                menuSide = St.Side.BOTTOM;
            }
            this._popupMenuSide = menuSide;

            if (this._menu) {
                this._menu._side = menuSide;
                if (this._menu._boxPointer) {
                    this._menu._boxPointer._side = menuSide;
                }
            }

            return super.popupMenu(menuSide);
        }

        activate(button) {
            this._animateClick();
            this._ensureVisible();

            const isMiddle = (button === Clutter.BUTTON_MIDDLE || button === 2);
            if (isMiddle) {
                this._onMiddleClick();
                return;
            }

            const currentEvent = Clutter.get_current_event();
            const state = currentEvent ? currentEvent.get_state() : 0;
            const isShift = (state & Clutter.ModifierType.SHIFT_MASK) !== 0;
            const isCtrl = (state & Clutter.ModifierType.CONTROL_MASK) !== 0;

            if (isShift) {
                const shiftGpu = this._dock?.settings?.get_boolean('shift-click-discrete-gpu') ?? true;
                if (shiftGpu && this.app) {
                    try {
                        const launchContext = global.create_app_launch_context(0, -1);
                        if (typeof launchContext.set_discrete_gpu === 'function') {
                            launchContext.set_discrete_gpu(true);
                        }
                        if (typeof launchContext.set_timestamp === 'function') {
                            launchContext.set_timestamp(global.get_current_time());
                        }
                        this.app.launch(0, -1, launchContext);
                        if (Main.overview.visible) {
                            Main.overview.hide();
                        }
                        return;
                    } catch (_) {}
                }
            }

            if (isCtrl) {
                if (this.app) {
                    this.app.open_new_window(-1);
                    if (Main.overview.visible) {
                        Main.overview.hide();
                    }
                    return;
                }
            }

            this._onPrimaryClick();
        }

        _onMiddleClick() {
            if (!this.app) return;

            const windows = this.app.get_windows();
            const settings = this._dock?.settings;
            const action = settings ? settings.get_string('middle-click-action') : 'CLOSE_ALL';

            if (windows.length === 0) {
                if (action !== 'NONE') {
                    this.app.open_new_window(-1);
                    if (Main.overview.visible) {
                        Main.overview.hide();
                    }
                }
                return;
            }

            switch (action) {
            case 'CLOSE_ALL': {
                const time = global.get_current_time();
                const wins = [...windows];
                for (const win of wins) {
                    win.delete(time);
                }
                break;
            }
            case 'NEW_WINDOW':
                this.app.open_new_window(-1);
                if (Main.overview.visible) {
                    Main.overview.hide();
                }
                break;
            case 'MINIMIZE':
                for (const win of windows) {
                    win.minimize();
                }
                break;
            case 'TOGGLE_FULLSCREEN': {
                const focusWindow = global.display.focus_window;
                const targetWin = (focusWindow && windows.includes(focusWindow)) ? focusWindow : windows[0];
                if (targetWin) {
                    if (targetWin.is_fullscreen()) {
                        targetWin.unmake_fullscreen();
                    } else {
                        targetWin.make_fullscreen();
                    }
                }
                break;
            }
            case 'NONE':
            default:
                break;
            }
        }

        _onPrimaryClick() {
            const windows = this.app.get_windows();
            const settings = this._dock?.settings;
            const clickAction = settings ? settings.get_string('click-action') : 'CYCLE';

            if (windows.length === 0) {
                this.app.open_new_window(-1);
                if (Main.overview.visible) {
                    Main.overview.hide();
                }
                return;
            }

            const focusWindow = global.display.focus_window;
            const isFocused = focusWindow && windows.includes(focusWindow);

            if (windows.length === 1) {
                const win = windows[0];
                if (isFocused && clickAction === 'MINIMIZE') {
                    win.minimize();
                } else {
                    Main.activateWindow(win);
                }
                return;
            }

            // Multiple windows
            switch (clickAction) {
                case 'MINIMIZE':
                    if (isFocused) {
                        focusWindow.minimize();
                    } else {
                        Main.activateWindow(windows[0]);
                    }
                    break;
                case 'PREVIEWS':
                    this._showPreviewMenu();
                    break;
                case 'FOCUS':
                    Main.activateWindow(windows[0]);
                    break;
                case 'CYCLE':
                default: {
                    if (!isFocused) {
                        Main.activateWindow(windows[0]);
                    } else {
                        const currentIndex = windows.indexOf(focusWindow);
                        const nextIndex = (currentIndex + 1) % windows.length;
                        Main.activateWindow(windows[nextIndex]);
                    }
                    break;
                }
            }
        }

        vfunc_scroll_event(scrollEvent) {
            const settings = this._dock?.settings;
            const action = settings ? settings.get_string('scroll-action') : 'CYCLE';

            if (action === 'CYCLE') {
                const windows = this.app ? this.app.get_windows() : [];
                if (windows.length > 1) {
                    const direction = typeof scrollEvent.get_scroll_direction === 'function' ?
                        scrollEvent.get_scroll_direction() : scrollEvent.direction;
                    const isUp = direction === Clutter.ScrollDirection.UP;
                    const isDown = direction === Clutter.ScrollDirection.DOWN;

                    if (isUp || isDown) {
                        const focusWindow = global.display.focus_window;
                        let nextIndex = 0;
                        if (focusWindow && windows.includes(focusWindow)) {
                            const cur = windows.indexOf(focusWindow);
                            nextIndex = isUp ? (cur - 1 + windows.length) % windows.length : (cur + 1) % windows.length;
                        }
                        Main.activateWindow(windows[nextIndex]);
                        return Clutter.EVENT_STOP;
                    }
                }
            } else if (action === 'SWITCH-WORKSPACE') {
                const direction = typeof scrollEvent.get_scroll_direction === 'function' ?
                    scrollEvent.get_scroll_direction() : scrollEvent.direction;
                const isUp = direction === Clutter.ScrollDirection.UP;
                const isDown = direction === Clutter.ScrollDirection.DOWN;

                if (isUp || isDown) {
                    const activeWorkspace = global.workspaceManager.get_active_workspace();
                    if (activeWorkspace) {
                        const nextWs = isUp ?
                            activeWorkspace.get_neighbor(Meta.MotionDirection.UP) :
                            activeWorkspace.get_neighbor(Meta.MotionDirection.DOWN);
                        if (nextWs && nextWs !== activeWorkspace) {
                            nextWs.activate(global.get_current_time());
                            return Clutter.EVENT_STOP;
                        }
                    }
                }
            }

            // Forward the scroll event to the dock
            if (this._dock?._dash?.handleScrollEvent) {
                const handled = this._dock._dash.handleScrollEvent(scrollEvent);
                if (handled === Clutter.EVENT_STOP) {
                    return Clutter.EVENT_STOP;
                }
            }

            return Clutter.EVENT_PROPAGATE;
        }

        _showPreviewMenu() {
            if (this._previewMenu && this._previewMenu.isOpen) {
                this._previewMenu.close(true);
                return;
            }

            if (!this._previewMenu) {
                let menuSide = St.Side.BOTTOM;
                if (this._dock?.settings) {
                    const pos = this._dock.settings.get_enum('dock-position');
                    switch (pos) {
                        case Position.TOP:
                            menuSide = St.Side.TOP;
                            break;
                        case Position.BOTTOM:
                            menuSide = St.Side.BOTTOM;
                            break;
                        case Position.LEFT:
                            menuSide = St.Side.LEFT;
                            break;
                        case Position.RIGHT:
                            menuSide = St.Side.RIGHT;
                            break;
                    }
                }
                this._previewMenu = new WindowPreviewMenu(this, this.app, menuSide, this._dock?.settings);
                this._previewMenuManager.addMenu(this._previewMenu);
                this._previewMenu.connect('open-state-changed', (menu, isOpen) => {
                    this.emit('menu-state-changed', isOpen);
                    if (!isOpen) {
                        this.set_hover(false);
                    }
                });
            }

            this.set_hover(true);
            this.emit('menu-state-changed', true);
            this._previewMenu.open(true);
        }

        _clearSpringTimeout() {
            if (this._springTimeoutId) {
                GLib.Source.remove(this._springTimeoutId);
                this._springTimeoutId = 0;
            }
            this._springActivated = false;
            this.remove_style_class_name('spring-active');
            const target = this._iconContainer || this.icon || this;
            target.remove_all_transitions();
            target.set_pivot_point(0.5, 0.5);
            target.ease({
                scale_x: 1.0,
                scale_y: 1.0,
                duration: 150,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
        }

        _triggerSpringActivation() {
            this._springActivated = true;
            this.remove_style_class_name('spring-active');

            if (!this.app) return;

            const windows = this.app.get_windows();
            // Only bring windows to foreground if the app is already open
            if (windows.length === 0) return;

            // Visual pulse on activation
            const target = this._iconContainer || this.icon || this;
            target.remove_all_transitions();
            target.set_pivot_point(0.5, 0.5);
            target.ease({
                scale_x: 1.22,
                scale_y: 1.22,
                duration: 100,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onComplete: () => {
                    target.ease({
                        scale_x: 1.0,
                        scale_y: 1.0,
                        duration: 180,
                        mode: Clutter.AnimationMode.EASE_OUT_BACK,
                    });
                },
            });

            const focusWindow = global.display.focus_window;
            let winToActivate = windows[0];
            if (focusWindow && windows.includes(focusWindow)) {
                winToActivate = focusWindow;
            }
            Main.activateWindow(winToActivate);

            if (Main.overview.visible) {
                Main.overview.hide();
            }
        }

        handleDragOver(source, _actor, _x, _y, _time) {
            const draggedApp = Dash.getAppFromSource ? Dash.getAppFromSource(source) : (source?.app || null);
            // If dragging an app within the dock (favorite reordering), leave it to Dash
            if (draggedApp) {
                this._clearSpringTimeout();
                return DND.DragMotionResult.CONTINUE;
            }

            if (!this.app) {
                return DND.DragMotionResult.CONTINUE;
            }

            const settings = this._dock?.settings;
            const springEnabled = settings ? settings.get_boolean('enable-spring-load') : true;
            const windows = this.app.get_windows();

            // Spring-load hover activation only runs on apps that are ALREADY open
            if (springEnabled && windows.length > 0) {
                if (!this._springTimeoutId && !this._springActivated) {
                    const delay = settings ? settings.get_int('spring-load-delay') : 500;
                    this.add_style_class_name('spring-active');

                    const target = this._iconContainer || this.icon || this;
                    target.remove_all_transitions();
                    target.set_pivot_point(0.5, 0.5);
                    target.ease({
                        scale_x: 1.15,
                        scale_y: 1.15,
                        duration: Math.min(200, delay),
                        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                    });

                    this._springTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
                        this._springTimeoutId = 0;
                        this._triggerSpringActivation();
                        return GLib.SOURCE_REMOVE;
                    });
                }
            } else {
                this._clearSpringTimeout();
            }

            return DND.DragMotionResult.COPY_DROP;
        }

        acceptDrop(source, _actor, _x, _y, _time) {
            this._clearSpringTimeout();

            const draggedApp = Dash.getAppFromSource ? Dash.getAppFromSource(source) : (source?.app || null);
            if (draggedApp) {
                return false;
            }

            if (!this.app) {
                return false;
            }

            // Extract file URIs if provided by the dragged payload
            let uris = [];
            if (typeof source.get_uris === 'function') {
                try {
                    uris = source.get_uris();
                } catch (_) {}
            } else if (Array.isArray(source.uriList)) {
                uris = source.uriList;
            } else if (typeof source.uriList === 'string') {
                uris = source.uriList.split('\r\n').filter(u => u.length > 0 && !u.startsWith('#'));
            } else if (source.realUri) {
                uris = [source.realUri];
            }

            if (uris && uris.length > 0) {
                try {
                    const launchContext = global.create_app_launch_context(0, -1);
                    this.app.launch_uris(uris, launchContext);
                    if (Main.overview.visible) {
                        Main.overview.hide();
                    }
                    return true;
                } catch (e) {
                    logError(e, `[GLD-1] Failed to launch URIs for ${this.app.get_id()}`);
                }
            }

            const windows = this.app.get_windows();
            if (windows.length > 0) {
                Main.activateWindow(windows[0]);
            } else {
                this.app.open_new_window(-1);
            }

            if (Main.overview.visible) {
                Main.overview.hide();
            }
            return true;
        }

        destroy() {
            this._clearSpringTimeout();
            if (this._runningContainer) {
                this._runningContainer.destroy();
                this._runningContainer = null;
            }
            if (this._previewMenuManager) {
                this._previewMenuManager.destroy?.();
                this._previewMenuManager = null;
            }
            if (this._previewMenu) {
                this._previewMenu.destroy();
                this._previewMenu = null;
            }
            if (this._menu) {
                this._menu.close();
            }
            this._signals?.destroy();
            this._signals = null;
            this._desktopInterfaceSettings = null;
            super.destroy();
        }
    });
