import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as AppFavorites from 'resource:///org/gnome/shell/ui/appFavorites.js';
import * as Dash from 'resource:///org/gnome/shell/ui/dash.js';
import * as DND from 'resource:///org/gnome/shell/ui/dnd.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {DockAppIcon} from './appIcons.js';
import {GlobalSignalsHandler, Position, ensureActorVisibleInScrollView} from './utils.js';

export const DockDashItemContainer = GObject.registerClass(
class DockDashItemContainer extends Dash.DashItemContainer {
    _init(dock = null) {
        super._init();
        this._dock = dock;
        this.scale_x = 1.0;
        this.scale_y = 1.0;
        this.opacity = 255;
    }

    showLabel() {
        if (!this._dock?.settings?.get_boolean('show-app-names'))
            return;

        if (!this._labelText)
            return;

        if (!this.label && !this._label) {
            super.showLabel();
        }

        const labelActor = this.label || this._label;
        if (!labelActor || !this.get_stage?.())
            return;

        labelActor.set_text(this._labelText);
        labelActor.opacity = 0;
        labelActor.show();

        const [stageX, stageY] = this.get_transformed_position();
        const node = labelActor.get_theme_node();
        const labelOffset = node ? node.get_length('-x-offset') || 8 : 8;

        const itemWidth = this.width || (this.allocation ? this.allocation.x2 - this.allocation.x1 : 48);
        const itemHeight = this.height || (this.allocation ? this.allocation.y2 - this.allocation.y1 : 48);
        const labelWidth = labelActor.get_width();
        const labelHeight = labelActor.get_height();

        let x = stageX;
        let y = stageY;

        const pos = this._dock?.settings ? this._dock.settings.get_enum('dock-position') : Position.BOTTOM;

        switch (pos) {
        case Position.LEFT:
            y = stageY + Math.floor((itemHeight - labelHeight) / 2);
            x = stageX + itemWidth + labelOffset;
            break;
        case Position.RIGHT:
            y = stageY + Math.floor((itemHeight - labelHeight) / 2);
            x = stageX - labelWidth - labelOffset;
            break;
        case Position.TOP:
            y = stageY + itemHeight + labelOffset;
            x = stageX + Math.floor((itemWidth - labelWidth) / 2);
            break;
        case Position.BOTTOM:
        default:
            y = stageY - labelHeight - labelOffset;
            x = stageX + Math.floor((itemWidth - labelWidth) / 2);
            break;
        }

        const monitor = Main.layoutManager.findMonitorForActor(this) || Main.layoutManager.primaryMonitor;
        if (monitor) {
            const gap = 5;
            if (x < monitor.x + gap) {
                x = monitor.x + gap;
            } else if (x + labelWidth > monitor.x + monitor.width - gap) {
                x = monitor.x + monitor.width - gap - labelWidth;
            }
            if (y < monitor.y + gap) {
                y = monitor.y + gap;
            } else if (y + labelHeight > monitor.y + monitor.height - gap) {
                y = monitor.y + monitor.height - gap - labelHeight;
            }
        }

        labelActor.remove_all_transitions();
        labelActor.set_position(Math.round(x), Math.round(y));
        labelActor.ease({
            opacity: 255,
            duration: 150,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    show(animate) {
        if (this.child == null)
            return;
        if (!animate) {
            this.scale_x = 1.0;
            this.scale_y = 1.0;
            this.opacity = 255;
            return;
        }
        super.show(animate);
    }
});

export const DockDragPlaceholderItem = GObject.registerClass(
class DockDragPlaceholderItem extends DockDashItemContainer {
    _init() {
        super._init();
        this.setChild(new St.Bin({style_class: 'placeholder'}));
    }
});

export const DockDash = GObject.registerClass({
    Signals: {
        'menu-opened': {},
        'menu-closed': {},
    },
},
class DockDash extends Dash.Dash {
    _init(dock) {
        this._dock = dock;
        this._signals = new GlobalSignalsHandler();
        this._fromDesktop = false;
        this._openMenus = new Set();

        super._init();

        this.add_style_class_name('gld1-dash');

        // Hide GNOME Shell's default internal dash background actor to avoid duplicate background
        if (this._background) {
            this._background.hide();
            this._background.set_opacity(0);
            this._background.set_style('background-color: transparent; border: none; box-shadow: none;');
        }

        // Reparent _box inside St.Viewport and St.ScrollView for smooth scrolling and clean clipping
        if (this._box && this._dashContainer) {
            if (this._box.get_parent() === this._dashContainer) {
                this._dashContainer.remove_child(this._box);
            }
        }

        this._viewport = new St.Viewport({
            x_expand: true,
            y_expand: true,
            x_align: Clutter.ActorAlign.FILL,
            y_align: Clutter.ActorAlign.FILL,
        });

        this._scrollView = new St.ScrollView({
            name: 'gld1DashScrollview',
            style_class: 'gld1-scrollview',
            hscrollbar_policy: St.PolicyType.EXTERNAL,
            vscrollbar_policy: St.PolicyType.NEVER,
            x_expand: true,
            y_expand: true,
            x_align: Clutter.ActorAlign.FILL,
            y_align: Clutter.ActorAlign.FILL,
            enable_mouse_scrolling: false,
            clip_to_allocation: true,
        });

        if (this._box) {
            this._box.x_align = Clutter.ActorAlign.FILL;
            this._box.y_align = Clutter.ActorAlign.FILL;
            this._box.x_expand = true;
            this._box.y_expand = true;
            if (typeof this._viewport.set_child === 'function') {
                this._viewport.set_child(this._box);
            } else {
                this._viewport.add_child(this._box);
            }
            this._box.clip_to_allocation = false;
            this._signals.add(
                [this._box, 'child-added', () => {
                    this._clampScrollAdjustment();
                    this._dock?.queueUpdateLayout();
                }],
                [this._box, 'child-removed', (_box, child) => {
                    if (this._openMenus && this._openMenus.has(child)) {
                        this._openMenus.delete(child);
                        if (this._openMenus.size === 0) {
                            this.emit('menu-closed');
                        }
                    }
                    this._clampScrollAdjustment();
                    this._dock?.queueUpdateLayout();
                }]
            );
        }

        if (typeof this._scrollView.set_child === 'function') {
            this._scrollView.set_child(this._viewport);
        } else {
            this._scrollView.add_child(this._viewport);
        }

        if (this._dashContainer) {
            this._dashContainer.add_child(this._scrollView);
            this._dashContainer.x_align = Clutter.ActorAlign.FILL;
            this._dashContainer.y_align = Clutter.ActorAlign.FILL;
            this._dashContainer.x_expand = true;
            this._dashContainer.y_expand = true;
            this._dashContainer.clip_to_allocation = false;
        }

        this._signals.add(
            [this, 'scroll-event', (_actor, event) => this._onScrollEvent(this, event)],
            [this._scrollView, 'scroll-event', (_actor, event) => this._onScrollEvent(this._scrollView, event)],
            [this._viewport, 'scroll-event', (_actor, event) => this._onScrollEvent(this._viewport, event)],
            [global.display, 'window-created', () => this._queueRedisplay()],
            [global.window_manager, 'destroy', () => this._queueRedisplay()],
            [global.window_manager, 'map', () => this._queueRedisplay()]
        );

        if (this._box) {
            this._signals.add([this._box, 'scroll-event', (_actor, event) => this._onScrollEvent(this._box, event)]);
        }

        if (this._dashContainer) {
            this._signals.add([this._dashContainer, 'scroll-event', (_actor, event) => this._onScrollEvent(this._dashContainer, event)]);
        }

        this.connect('destroy', () => this._onDestroy());

        this._applyPosition();
        this._applyIconSize();
        this._applyIconPadding();
        this._applyShowAppsPosition();
        this._updateShowAppsVisibility();

        if (this._showAppsIcon) {
            this._showAppsIcon.scale_x = 1.0;
            this._showAppsIcon.scale_y = 1.0;
            this._showAppsIcon.opacity = 255;
            this._showAppsIcon.track_hover = true;
            this._showAppsIcon.reactive = true;
            this._signals.add([
                this._showAppsIcon, 'scroll-event', (_actor, event) => this._onScrollEvent(this._showAppsIcon, event)
            ]);
        }
        if (this.showAppsButton) {
            this.showAppsButton.track_hover = true;
            this.showAppsButton.reactive = true;
            this._signals.add(
                [this.showAppsButton, 'clicked', () => this._onShowAppsClicked()],
                [this.showAppsButton, 'scroll-event', (_actor, event) => this._onScrollEvent(this.showAppsButton, event)]
            );
        }

        const controls = Main.overview._overview?.controls;
        if (controls?._stateAdjustment) {
            this._signals.add([
                controls._stateAdjustment, 'notify::value', () => this._syncShowAppsState()
            ]);
        }

        this._signals.add(
            [Main.overview, 'showing', () => this._syncShowAppsState()],
            [Main.overview, 'hiding', () => {
                this._fromDesktop = false;
                this._syncShowAppsState();
            }],
            [this._dock.settings, 'changed::dock-position', () => this._applyPosition()],
            [this._dock.settings, 'changed::dash-max-icon-size', () => this._applyIconSize()],
            [this._dock.settings, 'changed::show-apps-at-top', () => this._applyShowAppsPosition()],
            [this._dock.settings, 'changed::show-show-apps-button', () => this._updateShowAppsVisibility()],
            [this._dock.settings, 'changed::show-app-names', () => {
                if (!this._dock.settings.get_boolean('show-app-names')) {
                    this._hideAllLabels();
                }
            }]
        );
    }

    _syncLabel(item, appIcon) {
        const showNames = this._dock?.settings ? this._dock.settings.get_boolean('show-app-names') : false;
        if (showNames && appIcon?.hover) {
            item.showLabel();
        } else {
            item.hideLabel();
        }
    }

    _hideAllLabels() {
        if (this._box) {
            for (const child of this._box.get_children()) {
                if (typeof child.hideLabel === 'function') {
                    child.hideLabel();
                }
            }
        }
        const showApps = this._showAppsIcon || this.showAppsButton;
        if (showApps && typeof showApps.hideLabel === 'function') {
            showApps.hideLabel();
        }
    }

    _isVertical() {
        if (!this._dock?.settings) return false;
        const pos = this._dock.settings.get_enum('dock-position');
        return (pos === Position.LEFT || pos === Position.RIGHT);
    }

    canScroll() {
        if (!this._scrollView || !this._box) return false;
        const isVertical = this._isVertical();
        const [, boxW] = this._box.get_preferred_width(-1);
        const [, boxH] = this._box.get_preferred_height(-1);
        const viewW = this._scrollView.width || 0;
        const viewH = this._scrollView.height || 0;
        const maxScroll = isVertical
            ? Math.max(0, boxH - viewH)
            : Math.max(0, boxW - viewW);
        return maxScroll > 1;
    }

    handleScrollEvent(event) {
        return this._onScrollEvent(this, event);
    }

    _onScrollEvent(_actor, event) {
        if (!this._scrollView || !this._box) return Clutter.EVENT_PROPAGATE;

        const isVertical = this._isVertical();
        const iconSize = this.iconSize || (this._dock?.settings ? this._dock.settings.get_int('dash-max-icon-size') : 48) || 48;
        const scrollSpeed = this._dock?.settings ? this._dock.settings.get_double('scroll-speed') : 1.0;
        const increment = Math.max(10, Math.round(iconSize * (scrollSpeed || 1.0)));

        const direction = typeof event.get_scroll_direction === 'function'
            ? event.get_scroll_direction()
            : event.direction;

        let delta = 0;

        if (direction === Clutter.ScrollDirection.SMOOTH) {
            const [dx, dy] = event.get_scroll_delta();
            if (isVertical) {
                delta = (dy !== 0 ? dy : dx) * increment;
            } else {
                delta = (Math.abs(dx) > Math.abs(dy) ? dx : dy) * increment;
            }
        } else if (direction === Clutter.ScrollDirection.UP || direction === Clutter.ScrollDirection.LEFT) {
            delta = -increment;
        } else if (direction === Clutter.ScrollDirection.DOWN || direction === Clutter.ScrollDirection.RIGHT) {
            delta = increment;
        }

        if (delta === 0) {
            return Clutter.EVENT_PROPAGATE;
        }

        const [, boxW] = this._box.get_preferred_width(-1);
        const [, boxH] = this._box.get_preferred_height(-1);
        const viewW = this._scrollView.width || 0;
        const viewH = this._scrollView.height || 0;

        const maxScroll = isVertical
            ? Math.max(0, boxH - viewH)
            : Math.max(0, boxW - viewW);

        if (maxScroll <= 1) {
            return Clutter.EVENT_PROPAGATE;
        }

        const curVal = isVertical ? (-this._box.translation_y || 0) : (-this._box.translation_x || 0);
        const targetVal = Math.min(Math.max(0, curVal + delta), maxScroll);

        if (Math.abs(targetVal - curVal) > 0.5) {
            const animDuration = Math.max(50, Math.min(200, Math.round(110 / (scrollSpeed || 1.0))));
            this._box.remove_all_transitions();
            if (isVertical) {
                this._box.ease({
                    translation_y: -targetVal,
                    duration: animDuration,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                });
            } else {
                this._box.ease({
                    translation_x: -targetVal,
                    duration: animDuration,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                });
            }

            const adj = isVertical
                ? (this._scrollView.get_vadjustment ? this._scrollView.get_vadjustment() : this._scrollView.vadjustment)
                : (this._scrollView.get_hadjustment ? this._scrollView.get_hadjustment() : this._scrollView.hadjustment);
            if (adj && typeof adj.set_value === 'function') {
                adj.set_value(targetVal);
            }

            return Clutter.EVENT_STOP;
        }

        return Clutter.EVENT_STOP;
    }

    _clampScrollAdjustment() {
        if (!this._scrollView || !this._box) return;
        const isVertical = this._isVertical();
        const [, boxW] = this._box.get_preferred_width(-1);
        const [, boxH] = this._box.get_preferred_height(-1);
        const viewW = this._scrollView.width || 0;
        const viewH = this._scrollView.height || 0;
        const maxScroll = isVertical
            ? Math.max(0, boxH - viewH)
            : Math.max(0, boxW - viewW);

        if (isVertical) {
            if (-this._box.translation_y > maxScroll) {
                this._box.translation_y = -maxScroll;
            }
        } else {
            if (-this._box.translation_x > maxScroll) {
                this._box.translation_x = -maxScroll;
            }
        }
    }

    _animateClick(actor) {
        if (!actor) return;
        const target = actor._iconActor || actor.icon || actor._iconContainer || actor;
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

    _onShowAppsClicked() {
        this._animateClick(this._showAppsIcon || this.showAppsButton);

        const controls = Main.overview._overview?.controls;
        if (!controls) {
            Main.overview.toggle();
            return;
        }

        // ControlsState: HIDDEN = 0, WINDOW_PICKER = 1, APP_GRID = 2
        if (!Main.overview.visible) {
            this._fromDesktop = true;
            Main.overview.show(2); // APP_GRID
            return;
        }

        const stateVal = controls._stateAdjustment ? Math.round(controls._stateAdjustment.value) : 0;
        if (stateVal === 2) {
            // Already in APP_GRID
            if (this._fromDesktop) {
                Main.overview.hide();
                this._fromDesktop = false;
            } else {
                controls._stateAdjustment.ease(1, {
                    duration: 250,
                    mode: Clutter.AnimationMode.EASE_OUT_SINE,
                });
            }
        } else {
            // In WINDOW_PICKER -> switch to APP_GRID
            controls._stateAdjustment.ease(2, {
                duration: 250,
                mode: Clutter.AnimationMode.EASE_OUT_SINE,
            });
        }
    }

    _syncShowAppsState() {
        if (!this._signals || !this._dock || !this.showAppsButton) return;
        const controls = Main.overview._overview?.controls;
        if (!controls) return;

        try {
            const stateVal = controls._stateAdjustment ? Math.round(controls._stateAdjustment.value) : 0;
            const isAppGrid = Main.overview.visible && (stateVal === 2);
            if (this.showAppsButton && this.showAppsButton.checked !== undefined && this.showAppsButton.checked !== isAppGrid) {
                this.showAppsButton.checked = isAppGrid;
            }
        } catch (e) {
            // Button or actor might be disposed during teardown
        }
    }

    _applyPosition() {
        if (!this._dock?.settings) return;
        const pos = this._dock.settings.get_enum('dock-position');
        const isVertical = (pos === Position.LEFT || pos === Position.RIGHT);

        if (this._box?.layout_manager) {
            this._box.layout_manager.orientation = isVertical
                ? Clutter.Orientation.VERTICAL
                : Clutter.Orientation.HORIZONTAL;
        }
        if (this._box) {
            this._box.translation_x = 0;
            this._box.translation_y = 0;
            if (typeof this._box.set_vertical === 'function') {
                this._box.set_vertical(isVertical);
            } else {
                this._box.vertical = isVertical;
            }
            this._box.x_align = Clutter.ActorAlign.FILL;
            this._box.y_align = Clutter.ActorAlign.FILL;
            this._box.x_expand = true;
            this._box.y_expand = true;
        }

        if (this._viewport) {
            this._viewport.x_align = Clutter.ActorAlign.FILL;
            this._viewport.y_align = Clutter.ActorAlign.FILL;
            this._viewport.x_expand = true;
            this._viewport.y_expand = true;
        }

        if (this._dashContainer) {
            if (typeof this._dashContainer.set_vertical === 'function') {
                this._dashContainer.set_vertical(isVertical);
            } else {
                this._dashContainer.vertical = isVertical;
            }
            if (this._dashContainer.layout_manager) {
                this._dashContainer.layout_manager.orientation = isVertical
                    ? Clutter.Orientation.VERTICAL
                    : Clutter.Orientation.HORIZONTAL;
            }
            this._dashContainer.x_expand = true;
            this._dashContainer.y_expand = true;
            this._dashContainer.x_align = Clutter.ActorAlign.FILL;
            this._dashContainer.y_align = Clutter.ActorAlign.FILL;
        }

        if (this._scrollView) {
            this._scrollView.hscrollbar_policy = isVertical ? St.PolicyType.NEVER : St.PolicyType.EXTERNAL;
            this._scrollView.vscrollbar_policy = isVertical ? St.PolicyType.EXTERNAL : St.PolicyType.NEVER;
            this._scrollView.enable_mouse_scrolling = false;
            this._scrollView.x_expand = true;
            this._scrollView.y_expand = true;
            this._scrollView.x_align = Clutter.ActorAlign.FILL;
            this._scrollView.y_align = Clutter.ActorAlign.FILL;
        }

        if (isVertical) {
            this.remove_style_class_name('horizontal');
            this.add_style_class_name('vertical');
        } else {
            this.remove_style_class_name('vertical');
            this.add_style_class_name('horizontal');
        }

        this._updateAllIconsPadding(0);
        this._dock.queueUpdateLayout();
    }

    _updateAllIconsSize(size) {
        if (!size || size <= 0) return;
        this.iconSize = size;

        const hadj = this._scrollView?.get_hadjustment ? this._scrollView.get_hadjustment() : this._scrollView?.hadjustment;
        const vadj = this._scrollView?.get_vadjustment ? this._scrollView.get_vadjustment() : this._scrollView?.vadjustment;
        if (hadj) {
            hadj.step_increment = size;
        }
        if (vadj) {
            vadj.step_increment = size;
        }

        if (this._showAppsIcon) {
            if (this._showAppsIcon.icon) {
                if (typeof this._showAppsIcon.icon.setIconSize === 'function') {
                    this._showAppsIcon.icon.setIconSize(size);
                } else if (typeof this._showAppsIcon.icon.set_icon_size === 'function') {
                    this._showAppsIcon.icon.set_icon_size(size);
                }
            }
            if (typeof this._showAppsIcon.setIconSize === 'function') {
                this._showAppsIcon.setIconSize(size);
            }
            this._showAppsIcon.queue_relayout();
        }

        if (this.showAppsButton) {
            if (this.showAppsButton.icon) {
                if (typeof this.showAppsButton.icon.setIconSize === 'function') {
                    this.showAppsButton.icon.setIconSize(size);
                } else if (typeof this.showAppsButton.icon.set_icon_size === 'function') {
                    this.showAppsButton.icon.set_icon_size(size);
                }
            }
            this.showAppsButton.queue_relayout();
        }

        if (this._box) {
            const children = this._box.get_children();
            for (const item of children) {
                const appIcon = item.child || item;
                if (!appIcon) continue;

                if (typeof appIcon.setIconSize === 'function') {
                    appIcon.setIconSize(size);
                } else if (appIcon.icon) {
                    if (typeof appIcon.icon.setIconSize === 'function') {
                        appIcon.icon.setIconSize(size);
                    } else if (typeof appIcon.icon.set_icon_size === 'function') {
                        appIcon.icon.set_icon_size(size);
                    }
                }
                item.queue_relayout();
            }
            this._box.queue_relayout();
        }

        if (this._viewport) {
            this._viewport.queue_relayout();
        }
        if (this._scrollView) {
            this._scrollView.queue_relayout();
        }
        if (this._dashContainer) {
            this._dashContainer.queue_relayout();
        }
        this.queue_relayout();
    }

    _applyIconSize() {
        if (!this._dock?.settings) return;
        const size = this._dock.settings.get_int('dash-max-icon-size');
        this._updateAllIconsSize(size);
        this._redisplay();
    }

    _updateAllIconsPadding(padding) {
        if (padding === undefined || padding === null || padding < 0) return;
        this.iconPadding = padding;

        const pos = this._dock?.settings ? this._dock.settings.get_enum('dock-position') : Position.BOTTOM;
        const isVertical = (pos === Position.LEFT || pos === Position.RIGHT);
        const padX = isVertical ? Math.max(2, Math.round(padding * 0.5)) : padding;
        const padY = isVertical ? padding : Math.max(2, Math.round(padding * 0.5));
        const style = `padding: ${padY}px ${padX}px;`;

        if (this._showAppsIcon) {
            this._showAppsIcon.set_style('');
        }

        if (this.showAppsButton) {
            this.showAppsButton.set_style(style);
            if (this.showAppsButton.child && typeof this.showAppsButton.child.set_style === 'function') {
                this.showAppsButton.child.set_style('');
            }
        }

        if (this._box) {
            const children = this._box.get_children();
            for (const item of children) {
                const appIcon = item.child || item;
                if (!appIcon) continue;

                if (typeof appIcon.setIconPadding === 'function') {
                    appIcon.setIconPadding(padding, isVertical);
                } else if (typeof appIcon.set_style === 'function') {
                    appIcon.set_style(style);
                }
            }
        }
    }

    _applyIconPadding() {
        this._updateAllIconsPadding(0);
        this._redisplay();
    }

    _adjustIconSize() {
        if (!this._dock?.settings) return;
        const size = this._dock.settings.get_int('dash-max-icon-size');
        this._updateAllIconsSize(size);
    }

    _updateShowAppsVisibility() {
        if (!this._dock?.settings) return;
        const show = this._dock.settings.get_boolean('show-show-apps-button');
        if (this._showAppsIcon) {
            this._showAppsIcon.visible = show;
        } else if (this.showAppsButton) {
            this.showAppsButton.visible = show;
        }
    }

    _applyShowAppsPosition() {
        const showAppsActor = this._showAppsIcon || this.showAppsButton;
        if (!showAppsActor || !this._dashContainer || !this._dock?.settings) return;
        const showAppsAtTop = this._dock.settings.get_boolean('show-apps-at-top');
        const parent = showAppsActor.get_parent();
        if (parent === this._dashContainer) {
            if (showAppsAtTop) {
                this._dashContainer.set_child_at_index(showAppsActor, 0);
            } else {
                const count = this._dashContainer.get_n_children();
                if (count > 0) {
                    this._dashContainer.set_child_at_index(showAppsActor, count - 1);
                }
            }
        }
    }

    _createAppItem(app) {
        const item = new DockDashItemContainer(this._dock);
        const icon = new DockAppIcon(app, this._dock);

        icon.connect('menu-state-changed', (o, opened) => {
            this._itemMenuStateChanged(item, opened);
        });

        icon.connect('clicked', () => {
            if (this._scrollView) {
                ensureActorVisibleInScrollView(this._scrollView, item);
            }
        });

        item.setChild(icon);
        icon.label_actor = null;
        item.setLabelText(app.get_name());

        const size = this.iconSize || (this._dock?.settings ? this._dock.settings.get_int('dash-max-icon-size') : 48);
        if (typeof icon.setIconSize === 'function') {
            icon.setIconSize(size);
        } else if (icon.icon && typeof icon.icon.setIconSize === 'function') {
            icon.icon.setIconSize(size);
        }

        const pos = this._dock?.settings ? this._dock.settings.get_enum('dock-position') : Position.BOTTOM;
        const isVertical = (pos === Position.LEFT || pos === Position.RIGHT);
        const padding = 0;
        if (typeof icon.setIconPadding === 'function') {
            icon.setIconPadding(padding, isVertical);
        } else if (typeof icon.set_style === 'function') {
            const padX = isVertical ? 2 : 0;
            const padY = isVertical ? 0 : 2;
            icon.set_style(`padding: ${padY}px ${padX}px;`);
        }

        this._hookUpLabel(item, icon);

        return item;
    }

    _itemMenuStateChanged(item, opened) {
        if (!this._openMenus) {
            this._openMenus = new Set();
        }

        if (opened) {
            this._openMenus.add(item);
        } else {
            this._openMenus.delete(item);
        }

        try {
            Dash.Dash.prototype._itemMenuStateChanged.call(this, item, opened);
        } catch (e) {
            // upstream method might not exist or error
        }

        if (opened) {
            this.emit('menu-opened');
        } else if (this._openMenus.size === 0) {
            this.emit('menu-closed');
        }
    }

    hasOpenMenu() {
        return !!(this._openMenus && this._openMenus.size > 0);
    }

    _redisplay() {
        super._redisplay();
        const size = this._dock?.settings ? this._dock.settings.get_int('dash-max-icon-size') : this.iconSize;
        if (size) {
            this._updateAllIconsSize(size);
        }
        this._updateAllIconsPadding(0);
        this._applyShowAppsPosition();
        this._clampScrollAdjustment();
        if (this._dock) {
            this._dock.queueUpdateLayout();
        }
    }

    vfunc_get_preferred_width(forHeight) {
        let natWidth = 0;
        let minWidth = 0;

        if (this._dashContainer) {
            [minWidth, natWidth] = this._dashContainer.get_preferred_width(forHeight);
        }

        if (this.get_stage()) {
            const themeNode = this.get_theme_node();
            if (themeNode) {
                return themeNode.adjust_preferred_width(minWidth, natWidth);
            }
        }
        return [minWidth, natWidth];
    }

    vfunc_get_preferred_height(forWidth) {
        let natHeight = 0;
        let minHeight = 0;

        if (this._dashContainer) {
            [minHeight, natHeight] = this._dashContainer.get_preferred_height(forWidth);
        }

        if (this.get_stage()) {
            const themeNode = this.get_theme_node();
            if (themeNode) {
                return themeNode.adjust_preferred_height(minHeight, natHeight);
            }
        }
        return [minHeight, natHeight];
    }

    getNaturalWidth() {
        try {
            if (!this._box || !this._dashContainer) return 0;
            let w = 0;
            if (this._box && this._box.get_parent()) {
                const [, boxW] = this._box.get_preferred_width(-1);
                w += boxW || 0;
            }
            const showApps = this._showAppsIcon || this.showAppsButton;
            if (showApps && showApps.visible && showApps.get_parent()) {
                const [, showAppsW] = showApps.get_preferred_width(-1);
                const isVertical = this._isVertical();
                if (isVertical) {
                    w = Math.max(w, showAppsW || 0);
                } else {
                    w += showAppsW || 0;
                }
            }
            if (this.get_stage()) {
                const themeNode = this.get_theme_node();
                if (themeNode) {
                    const [, natW] = themeNode.adjust_preferred_width(w, w);
                    return Math.ceil(natW || w || 0);
                }
            }
            return Math.ceil(w || 0);
        } catch (e) {
            return 0;
        }
    }

    getNaturalHeight() {
        try {
            if (!this._box || !this._dashContainer) return 0;
            let h = 0;
            if (this._box && this._box.get_parent()) {
                const [, boxH] = this._box.get_preferred_height(-1);
                h += boxH || 0;
            }
            const showApps = this._showAppsIcon || this.showAppsButton;
            if (showApps && showApps.visible && showApps.get_parent()) {
                const [, showAppsH] = showApps.get_preferred_height(-1);
                const isVertical = this._isVertical();
                if (isVertical) {
                    h += showAppsH || 0;
                } else {
                    h = Math.max(h, showAppsH || 0);
                }
            }
            if (this.get_stage()) {
                const themeNode = this.get_theme_node();
                if (themeNode) {
                    const [, natH] = themeNode.adjust_preferred_height(h, h);
                    return Math.ceil(natH || h || 0);
                }
            }
            return Math.ceil(h || 0);
        } catch (e) {
            return 0;
        }
    }

    _clearDragPlaceholder() {
        if (this._dragPlaceholder) {
            this._animatingPlaceholdersCount++;
            this._dragPlaceholder.connect('destroy', () => {
                this._animatingPlaceholdersCount--;
            });
            this._dragPlaceholder.animateOutAndDestroy();
            this._dragPlaceholder = null;
        }
        this._dragPlaceholderPos = -1;
    }

    _clearEmptyDropTarget() {
        if (this._emptyDropTarget) {
            this._emptyDropTarget.animateOutAndDestroy();
            this._emptyDropTarget = null;
        }
    }

    _onItemDragBegin() {
        this._dragCancelled = false;
        this._dragMonitor = {
            dragMotion: this._onItemDragMotion.bind(this),
        };
        DND.addDragMonitor(this._dragMonitor);

        if (this._box.get_n_children() === 0) {
            this._emptyDropTarget = new DockDragPlaceholderItem();
            this._box.insert_child_at_index(this._emptyDropTarget, 0);
            this._emptyDropTarget.show(true);
        }
    }

    _onItemDragCancelled() {
        this._dragCancelled = true;
        this._endItemDrag();
    }

    _onItemDragEnd() {
        if (this._dragCancelled)
            return;

        this._endItemDrag();
    }

    _clearAllSpringTimeouts(currentActor = null) {
        if (!this._box) return;
        const children = this._box.get_children();
        for (const child of children) {
            const icon = child?.child || child;
            if (icon && typeof icon._clearSpringTimeout === 'function') {
                const isTarget = currentActor && (
                    icon === currentActor ||
                    child === currentActor ||
                    (typeof icon.contains === 'function' && icon.contains(currentActor)) ||
                    (typeof child.contains === 'function' && child.contains(currentActor))
                );
                if (!isTarget) {
                    icon._clearSpringTimeout();
                }
            }
        }
    }

    _endItemDrag() {
        this._clearDragPlaceholder();
        this._clearEmptyDropTarget();
        this._clearAllSpringTimeouts();
        if (this._showAppsIcon && typeof this._showAppsIcon.setDragApp === 'function') {
            this._showAppsIcon.setDragApp(null);
        }
        if (this._dragMonitor) {
            DND.removeDragMonitor(this._dragMonitor);
            this._dragMonitor = null;
        }
    }

    _onItemDragMotion(dragEvent) {
        const app = Dash.getAppFromSource ? Dash.getAppFromSource(dragEvent.source) : (dragEvent.source?.app || null);
        if (app == null)
            return DND.DragMotionResult.CONTINUE;

        const showAppsActor = this._showAppsIcon || this.showAppsButton;
        let showAppsHovered = false;
        if (showAppsActor && dragEvent.targetActor) {
            showAppsHovered = showAppsActor.contains(dragEvent.targetActor);
        }

        const isOverBox = this._box && dragEvent.targetActor && this._box.contains(dragEvent.targetActor);
        const isOverDash = dragEvent.targetActor && this.contains(dragEvent.targetActor);

        if ((!isOverBox && !isOverDash) || showAppsHovered)
            this._clearDragPlaceholder();

        if (this._showAppsIcon && typeof this._showAppsIcon.setDragApp === 'function') {
            if (showAppsHovered)
                this._showAppsIcon.setDragApp(app);
            else
                this._showAppsIcon.setDragApp(null);
        }

        return DND.DragMotionResult.CONTINUE;
    }

    handleDragOver(source, actor, _x, _y, _time) {
        const app = Dash.getAppFromSource ? Dash.getAppFromSource(source) : (source?.app || null);

        if (app == null || (typeof app.is_window_backed === 'function' && app.is_window_backed()))
            return DND.DragMotionResult.NO_DROP;

        if (!global.settings.is_writable('favorite-apps'))
            return DND.DragMotionResult.NO_DROP;

        const appFavorites = AppFavorites.getAppFavorites();
        const favorites = appFavorites.getFavorites();
        const numFavorites = favorites.length;
        const favPos = favorites.indexOf(app);

        let pointerX = 0, pointerY = 0;
        if (typeof global.get_pointer === 'function') {
            const [gx, gy] = global.get_pointer();
            pointerX = gx;
            pointerY = gy;
        } else if (actor) {
            const [ax, ay] = actor.get_transformed_position();
            pointerX = ax + (actor.width / 2);
            pointerY = ay + (actor.height / 2);
        }

        const isVertical = this._isVertical();
        const cursorCoord = isVertical ? pointerY : pointerX;

        let pos;
        if (this._emptyDropTarget) {
            pos = 0;
        } else {
            const items = this._box.get_children().filter(c =>
                c !== this._dragPlaceholder && c !== this._separator && c !== this._emptyDropTarget);
            pos = items.length;
            const isRTL = (!isVertical && Clutter.get_default_text_direction() === Clutter.TextDirection.RTL);

            for (let i = 0; i < items.length; i++) {
                const item = items[i];
                const [itemStageX, itemStageY] = item.get_transformed_position();
                const itemMid = isVertical
                    ? (itemStageY + (item.height / 2))
                    : (itemStageX + (item.width / 2));

                if (isRTL) {
                    if (cursorCoord > itemMid) {
                        pos = i;
                        break;
                    }
                } else {
                    if (cursorCoord < itemMid) {
                        pos = i;
                        break;
                    }
                }
            }
        }

        if (pos > numFavorites)
            pos = numFavorites;

        if (pos !== this._dragPlaceholderPos && this._animatingPlaceholdersCount === 0) {
            this._dragPlaceholderPos = pos;

            // Don't allow positioning before or after self if already favorite
            if (favPos !== -1 && (pos === favPos || pos === favPos + 1)) {
                this._clearDragPlaceholder();
                return DND.DragMotionResult.CONTINUE;
            }

            let fadeIn;
            if (this._dragPlaceholder) {
                this._dragPlaceholder.destroy();
                fadeIn = false;
            } else {
                fadeIn = true;
            }

            this._dragPlaceholder = new DockDragPlaceholderItem();
            const size = this.iconSize || 48;
            if (isVertical) {
                this._dragPlaceholder.child.set_width(size / 2);
                this._dragPlaceholder.child.set_height(size);
            } else {
                this._dragPlaceholder.child.set_width(size);
                this._dragPlaceholder.child.set_height(size / 2);
            }

            this._box.insert_child_at_index(
                this._dragPlaceholder,
                this._dragPlaceholderPos);
            this._dragPlaceholder.show(fadeIn);
        }

        if (!this._dragPlaceholder)
            return DND.DragMotionResult.NO_DROP;

        if (this._scrollView) {
            const children = this._box.get_children();
            if (this._dragPlaceholderPos > 0 && children[this._dragPlaceholderPos - 1]) {
                ensureActorVisibleInScrollView(this._scrollView, children[this._dragPlaceholderPos - 1]);
            }
            if (this._dragPlaceholderPos >= 0 && this._dragPlaceholderPos < children.length - 1 && children[this._dragPlaceholderPos + 1]) {
                ensureActorVisibleInScrollView(this._scrollView, children[this._dragPlaceholderPos + 1]);
            }
        }

        return DND.DragMotionResult.MOVE_DROP;
    }

    acceptDrop(source, _actor, _x, _y, _time) {
        const app = Dash.getAppFromSource ? Dash.getAppFromSource(source) : (source?.app || null);

        if (app == null || (typeof app.is_window_backed === 'function' && app.is_window_backed()))
            return false;

        if (!global.settings.is_writable('favorite-apps'))
            return false;

        const id = app.get_id();
        const appFavorites = AppFavorites.getAppFavorites();
        const favorites = appFavorites.getFavoriteMap();
        const srcIsFavorite = id in favorites;

        let favPos = 0;
        const children = this._box.get_children();
        for (let i = 0; i < this._dragPlaceholderPos; i++) {
            if (this._dragPlaceholder && children[i] === this._dragPlaceholder)
                continue;

            const childItem = children[i]?.child || children[i];
            const childApp = childItem?._delegate?.app || childItem?.app;
            if (!childApp)
                continue;

            const childId = childApp.get_id();
            if (childId === id)
                continue;
            if (childId in favorites)
                favPos++;
        }

        if (!this._dragPlaceholder)
            return true;

        this._clearDragPlaceholder();

        const laters = global.compositor.get_laters();
        laters.add(Meta.LaterType.BEFORE_REDRAW, () => {
            if (srcIsFavorite)
                appFavorites.moveFavoriteToPos(id, favPos);
            else
                appFavorites.addFavoriteAtPos(id, favPos);
            return GLib.SOURCE_REMOVE;
        });

        return true;
    }

    _onDestroy() {
        this._hideAllLabels();
        if (this._dragMonitor) {
            DND.removeDragMonitor(this._dragMonitor);
            this._dragMonitor = null;
        }
        this._clearDragPlaceholder();
        this._clearEmptyDropTarget();
        if (this._openMenus) {
            this._openMenus.clear();
            this._openMenus = null;
        }
        if (this._signals) {
            this._signals.destroy();
            this._signals = null;
        }
        this._viewport = null;
        this._scrollView = null;
        this._dock = null;
    }

    destroy() {
        this._onDestroy();
        super.destroy();
    }
});
