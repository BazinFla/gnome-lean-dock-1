// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

import Clutter from 'gi://Clutter';
import St from 'gi://St';

import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const _ = s => s;

export class WindowPreviewMenu extends PopupMenu.PopupMenu {
    constructor(sourceActor, app, side = St.Side.BOTTOM, settings = null) {
        super(sourceActor, 0.5, side);

        this._app = app;
        this._sourceActor = sourceActor;
        this._settings = settings;
        this._stageEventId = 0;
        this._overviewHidingId = 0;
        this._focusWindowId = 0;
        this.blockSourceEvents = true;
        this.actor.add_style_class_name('gld1-preview-menu');

        Main.uiGroup.add_child(this.actor);
        this.actor.hide();
    }

    _buildItems() {
        this.removeAll();
        const windows = this._app ? this._app.get_windows() : [];
        if (windows.length === 0) {
            return;
        }

        const previewStyle = this._settings ? this._settings.get_string('window-preview-style') : 'THUMBNAIL';

        if (previewStyle === 'LIST') {
            this._buildListItems(windows);
        } else {
            this._buildThumbnailItems(windows);
        }
    }

    _buildThumbnailItems(windows) {
        const previewWidth = this._settings ? this._settings.get_int('window-preview-size') : 220;
        const previewHeight = Math.round(previewWidth * 0.625);

        const containerItem = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
            activate: false,
            style_class: 'gld1-preview-container-item',
        });

        const cardsBox = new St.BoxLayout({
            vertical: false,
            style_class: 'gld1-preview-cards-box',
            x_expand: true,
            y_expand: true,
        });

        for (const win of windows) {
            const card = new St.BoxLayout({
                vertical: true,
                style_class: 'gld1-preview-card',
                reactive: true,
                track_hover: true,
                can_focus: true,
            });

            // Header Box (App Icon + Title + Close Button)
            const headerBox = new St.BoxLayout({
                vertical: false,
                style_class: 'gld1-preview-card-header',
                x_expand: true,
            });

            const icon = new St.Icon({
                gicon: this._app.get_icon(),
                icon_size: 16,
                y_align: Clutter.ActorAlign.CENTER,
            });
            headerBox.add_child(icon);

            const title = win.get_title() || this._app.get_name();
            const titleLabel = new St.Label({
                text: title,
                style_class: 'gld1-preview-title',
                y_align: Clutter.ActorAlign.CENTER,
                x_expand: true,
            });
            headerBox.add_child(titleLabel);

            const closeTopBtn = new St.Button({
                style_class: 'gld1-preview-action-btn close',
                child: new St.Icon({
                    icon_name: 'window-close-symbolic',
                    icon_size: 14,
                }),
            });
            closeTopBtn.connect('clicked', () => {
                win.delete(global.get_current_time());
                this.close();
            });
            headerBox.add_child(closeTopBtn);

            card.add_child(headerBox);

            // Thumbnail Container
            const thumbnailBin = new St.Bin({
                style_class: 'gld1-preview-thumbnail-bin',
                width: previewWidth,
                height: previewHeight,
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
            });

            const mutterWindow = typeof win.get_compositor_private === 'function' ?
                win.get_compositor_private() : null;

            if (mutterWindow && !win.minimized) {
                const frameRect = win.get_frame_rect();
                const scale = Math.min(
                    previewWidth / Math.max(frameRect.width, 1),
                    previewHeight / Math.max(frameRect.height, 1)
                );
                const cloneW = Math.max(1, Math.round(frameRect.width * scale));
                const cloneH = Math.max(1, Math.round(frameRect.height * scale));

                const clone = new Clutter.Clone({
                    source: mutterWindow,
                    reactive: false,
                    width: cloneW,
                    height: cloneH,
                    x_align: Clutter.ActorAlign.CENTER,
                    y_align: Clutter.ActorAlign.CENTER,
                });
                thumbnailBin.set_child(clone);
            } else {
                // Fallback for minimized or uncomposited windows
                const fallbackBox = new St.BoxLayout({
                    vertical: true,
                    style_class: 'gld1-preview-fallback',
                    x_align: Clutter.ActorAlign.CENTER,
                    y_align: Clutter.ActorAlign.CENTER,
                    x_expand: true,
                    y_expand: true,
                });

                const fallbackIcon = new St.Icon({
                    gicon: this._app.get_icon(),
                    icon_size: 48,
                    x_align: Clutter.ActorAlign.CENTER,
                });
                const fallbackLabel = new St.Label({
                    text: win.minimized ? _('Minimized') : _('Active Window'),
                    style_class: 'gld1-preview-fallback-label',
                    x_align: Clutter.ActorAlign.CENTER,
                });

                fallbackBox.add_child(fallbackIcon);
                fallbackBox.add_child(fallbackLabel);
                thumbnailBin.set_child(fallbackBox);
            }

            card.add_child(thumbnailBin);

            // Quick Actions Bar (Minimize, Maximize, Close)
            const actionsBar = new St.BoxLayout({
                vertical: false,
                style_class: 'gld1-preview-actions-bar',
                x_align: Clutter.ActorAlign.END,
            });

            const minBtn = new St.Button({
                style_class: 'gld1-preview-action-btn',
                child: new St.Icon({
                    icon_name: 'window-minimize-symbolic',
                    icon_size: 14,
                }),
            });
            minBtn.connect('clicked', () => {
                if (win.minimized) {
                    win.unminimize();
                } else {
                    win.minimize();
                }
                this.close();
            });
            actionsBar.add_child(minBtn);

            const isMaximized = Boolean(win.maximized_horizontally && win.maximized_vertically);
            const maxBtn = new St.Button({
                style_class: 'gld1-preview-action-btn',
                child: new St.Icon({
                    icon_name: isMaximized ? 'window-restore-symbolic' : 'window-maximize-symbolic',
                    icon_size: 14,
                }),
            });
            maxBtn.connect('clicked', () => {
                if (isMaximized) {
                    win.unmaximize();
                } else {
                    win.maximize();
                }
                this.close();
            });
            actionsBar.add_child(maxBtn);

            const closeBottomBtn = new St.Button({
                style_class: 'gld1-preview-action-btn close',
                child: new St.Icon({
                    icon_name: 'window-close-symbolic',
                    icon_size: 14,
                }),
            });
            closeBottomBtn.connect('clicked', () => {
                win.delete(global.get_current_time());
                this.close();
            });
            actionsBar.add_child(closeBottomBtn);

            card.add_child(actionsBar);

            // Click on card body activates window
            card.connect('button-press-event', (actor, event) => {
                if (event.get_button() === 1) {
                    Main.activateWindow(win);
                    this.close();
                    return Clutter.EVENT_STOP;
                }
                return Clutter.EVENT_PROPAGATE;
            });

            cardsBox.add_child(card);
        }

        containerItem.add_child(cardsBox);
        this.addMenuItem(containerItem);
    }

    _buildListItems(windows) {
        for (const win of windows) {
            const title = win.get_title() || this._app.get_name();
            const item = new PopupMenu.PopupBaseMenuItem({
                activate: true,
                style_class: 'gld1-window-item',
            });

            const icon = new St.Icon({
                gicon: this._app.get_icon(),
                icon_size: 24,
                style_class: 'gld1-window-item-icon',
            });
            item.add_child(icon);

            const label = new St.Label({
                text: title,
                y_align: Clutter.ActorAlign.CENTER,
                x_expand: true,
                style_class: 'gld1-window-item-label',
            });
            item.add_child(label);

            const closeBtn = new St.Button({
                style_class: 'gld1-window-close-button',
                child: new St.Icon({
                    icon_name: 'window-close-symbolic',
                    icon_size: 16,
                }),
            });
            closeBtn.connect('clicked', () => {
                win.delete(global.get_current_time());
                this.close();
            });
            item.add_child(closeBtn);

            item.connect('activate', () => {
                Main.activateWindow(win);
                this.close();
            });

            this.addMenuItem(item);
        }
    }

    open(animate) {
        this._buildItems();
        super.open(animate);

        if (!this._stageEventId) {
            this._stageEventId = global.stage.connect('captured-event', (stage, event) => {
                if (!this.isOpen) return Clutter.EVENT_PROPAGATE;

                const type = event.type();
                if (type === Clutter.EventType.BUTTON_PRESS || type === Clutter.EventType.TOUCH_BEGIN) {
                    const target = event.get_source ? event.get_source() : (event.get_target_actor ? event.get_target_actor() : null);
                    if (target && !this.actor.contains(target) && !this._sourceActor.contains(target)) {
                        this.close(true);
                        return Clutter.EVENT_PROPAGATE;
                    }
                } else if (type === Clutter.EventType.KEY_PRESS) {
                    const symbol = event.get_key_symbol ? event.get_key_symbol() : 0;
                    if (symbol === Clutter.KEY_Escape) {
                        this.close(true);
                        return Clutter.EVENT_STOP;
                    }
                }
                return Clutter.EVENT_PROPAGATE;
            });
        }

        if (!this._overviewHidingId && Main.overview) {
            this._overviewHidingId = Main.overview.connect('hiding', () => this.close(true));
        }

        if (!this._focusWindowId && global.display) {
            this._focusWindowId = global.display.connect('notify::focus-window', () => {
                this.close(true);
            });
        }
    }

    close(animate) {
        if (this._stageEventId) {
            global.stage.disconnect(this._stageEventId);
            this._stageEventId = 0;
        }
        if (this._overviewHidingId && Main.overview) {
            Main.overview.disconnect(this._overviewHidingId);
            this._overviewHidingId = 0;
        }
        if (this._focusWindowId && global.display) {
            global.display.disconnect(this._focusWindowId);
            this._focusWindowId = 0;
        }
        super.close(animate);
    }

    destroy() {
        this.close(false);
        if (this._focusWindowId && global.display) {
            global.display.disconnect(this._focusWindowId);
            this._focusWindowId = 0;
        }
        if (this.actor && this.actor.get_parent() === Main.uiGroup) {
            Main.uiGroup.remove_child(this.actor);
        }
        this._settings = null;
        this._app = null;
        this._sourceActor = null;
        super.destroy();
    }
}
