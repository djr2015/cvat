/* exported PlayerModel PlayerController PlayerView */
"use strict";

class FrameProvider extends Listener {
    constructor(stop, tid) {
        super('onFrameLoad', () => this._loaded);
        this._MAX_LOAD = 500;

        this._stack = [];
        this._loadInterval = null;
        this._required = null;
        this._loaded = null;
        this._loadAllowed = true;
        this._preloadRunned = false;
        this._loadCounter = this._MAX_LOAD;
        this._frameCollection = {};
        this._stop = stop;
        this._tid = tid;
    }

    require(frame) {
        if (frame in this._frameCollection) {
            this._preload(frame);
            return this._frameCollection[frame];
        }
        this._required = frame;
        this._loadCounter = this._MAX_LOAD;
        this._load();
        return null;
    }

    _onImageLoad(image, frame) {
        let next = frame + 1;
        if (next <= this._stop && this._loadCounter > 0) {
            this._stack.push(next);
        }

        this._loadCounter--;
        this._loaded = frame;
        this._frameCollection[frame] = image;
        this._loadAllowed = true;
        this.notify();
    }

    _preload(frame) {
        if (this._preloadRunned) {
            return;
        }

        let last = Math.min(this._stop, frame + Math.ceil(this._MAX_LOAD / 2));
        if (!(last in this._frameCollection)) {
            for (let idx = frame + 1; idx <= last; idx ++) {
                if (!(idx in this._frameCollection)) {
                    this._loadCounter = this._MAX_LOAD - (idx - frame);
                    this._stack.push(idx);
                    this._preloadRunned = true;
                    this._load();
                    return;
                }
            }
        }
    }

    _load() {
        if (!this._loadInterval) {
            this._loadInterval = setInterval(function() {
                if (!this._loadAllowed) {
                    return;
                }

                if (this._loadCounter <= 0) {
                    this._stack = [];
                }

                if (!this._stack.length && this._required == null) {
                    clearInterval(this._loadInterval);
                    this._preloadRunned = false;
                    this._loadInterval = null;
                    return;
                }

                if (this._required != null) {
                    this._stack.push(this._required);
                    this._required = null;
                }

                let frame = this._stack.pop();
                if (frame in this._frameCollection) {
                    this._loadCounter--;
                    let next = frame + 1;
                    if (next <= this._stop && this._loadCounter > 0) {
                        this._stack.push(frame + 1);
                    }
                    return;
                }

                // If load up to last frame, no need to load previous frames from stack
                if (frame === this._stop) {
                    this._stack = [];
                }

                this._loadAllowed = false;
                let image = new Image();
                image.onload = this._onImageLoad.bind(this, image, frame);
                image.src = `get/task/${this._tid}/frame/${frame}`;
            }.bind(this), 25);
        }
    }
}


const MAX_PLAYER_SCALE = 10;
const MIN_PLAYER_SCALE = 0.1;

class PlayerModel extends Listener {
    constructor(job, playerSize) {
        super('onPlayerUpdate', () => this);
        this._frame = {
            start: job.start,
            stop: job.stop,
            current: job.start,
            previous: null
        };

        this._settings = {
            multipleStep: 10,
            fps: 25,
            resetZoom: job.mode === 'annotation'
        };

        this._playInterval = null;
        this._pauseFlag = null;
        this._frameProvider = new FrameProvider(this._frame.stop, job.taskid);
        this._continueAfterLoad = false;
        this._continueTimeout = null;

        this._geometry = {
            scale: 1,
            left: 0,
            top: 0,
            width: playerSize.width,
            height: playerSize.height
        };

        this._frameProvider.subscribe(this);
    }

    get frames() {
        return {
            start: this._frame.start,
            stop: this._frame.stop,
            current: this._frame.current,
            previous: this._frame.previous
        };
    }

    get geometry() {
        return {
            scale: this._geometry.scale,
            top: this._geometry.top,
            left: this._geometry.left
        };
    }

    get playing() {
        return this._playInterval != null;
    }

    get image() {
        return this._frameProvider.require(this._frame.current);
    }

    get resetZoom() {
        return this._settings.resetZoom;
    }

    get multipleStep() {
        return this._settings.multipleStep;
    }

    set fps(value) {
        this._settings.fps = value;
    }

    set multipleStep(value) {
        this._settings.multipleStep = value;
    }

    set resetZoom(value) {
        this._settings.resetZoom = value;
    }

    onFrameLoad(last) {  // callback for FrameProvider instance
        if (last === this._frame.current) {
            if (this._continueTimeout) {
                clearTimeout(this._continueTimeout);
                this._continueTimeout = null;
            }

            // If need continue playing after load, set timeout for additional frame download
            if (this._continueAfterLoad) {
                this._continueTimeout = setTimeout(function() {
                    // If you still need to play, start it
                    this._continueTimeout = null;
                    if (this._continueAfterLoad) {
                        this._continueAfterLoad = false;
                        this.play();
                    }   // Else update the frame
                    else {
                        this.shift(0);
                    }
                }.bind(this), 5000);
            }
            else {  // Just update frame if no need to play
                this.shift(0);
            }
        }
    }

    play() {

        this._pauseFlag = false;
        this._playInterval = setInterval(function() {
            if (this._pauseFlag) {      // pause method without notify (for frame downloading)
                if (this._playInterval) {
                    clearInterval(this._playInterval);
                    this._playInterval = null;
                }
                return;
            }

            let skip = Math.max( Math.floor(this._settings.fps / 25), 1 );
            if (!this.shift(skip)) this.pause();   // if not changed, pause
        }.bind(this), 1000 / this._settings.fps);
    }

    pause() {
        clearInterval(this._playInterval);
        this._playInterval = null;
        this._pauseFlag = true;
        this.notify();
    }

    shift(delta, absolute) {
        // TODO: lazy addition : bugs?
        $("[activeKeypointText]").remove();
        this._continueAfterLoad = false;  // default reset continue
        this._frame.current = Math.clamp(
            absolute ? delta : this._frame.current + delta,
            this._frame.start,
            this._frame.stop
        );
        if (!this._frameProvider.require(this._frame.current)) {
            this._continueAfterLoad = this.playing;
            this._pauseFlag = true;
            this.notify();
            return false;
        }

        if (this._settings.resetZoom || this._frame.previous === null) {  // fit in annotation mode or once in interpolation mode
            this.fit();     // notify() inside the fit()
        }
        else {
            this.notify();
        }

        let frameChanged = this._frame.previous - this._frame.current;
        this._frame.previous = this._frame.current;
        return frameChanged != 0;
    }

    fit() {
        let img = this._frameProvider.require(this._frame.current);
        if (!img) return;
        this._geometry.scale = Math.min(this._geometry.width / img.width, this._geometry.height / img.height);
        this._geometry.top = (this._geometry.height - img.height * this._geometry.scale) / 2;
        this._geometry.left = (this._geometry.width - img.width * this._geometry.scale ) / 2;
        this.notify();
    }

    focus(xtl, xbr, ytl, ybr) {
        if (!this._frameProvider.require(this._frame.current)) return;
        let boxWidth = xbr - xtl;
        let boxHeight = ybr - ytl;
        let wScale = this._geometry.width / boxWidth;
        let hScale = this._geometry.height / boxHeight;
        this._geometry.scale = Math.min(wScale, hScale);
        this._geometry.scale = Math.min(this._geometry.scale, MAX_PLAYER_SCALE);
        this._geometry.scale = Math.max(this._geometry.scale, MIN_PLAYER_SCALE);
        this._geometry.left = (this._geometry.width / this._geometry.scale - xtl * 2 - boxWidth) * this._geometry.scale / 2;
        this._geometry.top = (this._geometry.height / this._geometry.scale - ytl * 2 - boxHeight) * this._geometry.scale / 2;
        this._frame.previous = this._frame.current;     // fix infinite loop via playerUpdate->collectionUpdate*->AAMUpdate->playerUpdate->...
        this.notify();
    }

    scale(x, y, value) {
        if (!this._frameProvider.require(this._frame.current)) return;

        let currentCenter = {
            x: (x - this._geometry.left) / this._geometry.scale,
            y: (y - this._geometry.top) / this._geometry.scale
        };

        this._geometry.scale = value > 0 ? this._geometry.scale * 6/5 : this._geometry.scale * 5/6;
        this._geometry.scale = Math.min(this._geometry.scale, MAX_PLAYER_SCALE);
        this._geometry.scale = Math.max(this._geometry.scale, MIN_PLAYER_SCALE);

        let newCenter = {
            x: (x - this._geometry.left) / this._geometry.scale,
            y: (y - this._geometry.top) / this._geometry.scale
        };

        this._geometry.left += (newCenter.x - currentCenter.x) * this._geometry.scale;
        this._geometry.top += (newCenter.y - currentCenter.y) * this._geometry.scale;
        this.notify();
    }

    move(topOffset, leftOffset) {
        this._geometry.top += topOffset;
        this._geometry.left += leftOffset;
        this.notify();
    }
}


class PlayerController {
    constructor(playerModel, activeTrack, filterFrame, playerOffset) {
        this._model = playerModel;
        this._rewinding = false;
        this._moving = false;
        this._leftOffset = playerOffset.left;
        this._topOffset = playerOffset.top;
        this._lastClickX = 0;
        this._lastClickY = 0;
        this._moveFrameEvent = null;

        setupPlayerShortcuts.call(this, playerModel);

        function setupPlayerShortcuts(playerModel) {
            let nextHandler = Logger.shortkeyLogDecorator(function(e) {
                this.next();
                e.preventDefault();
            }.bind(this));

            let prevHandler = Logger.shortkeyLogDecorator(function(e) {
                this.previous();
                e.preventDefault();
            }.bind(this));


            //TODO: setActiveKeypoint when changing keyFrames
            let nextKeyFrameHandler = Logger.shortkeyLogDecorator(function() {
                let active = activeTrack();
                if (active && active.trackType === 'interpolation') {
                    let nextKeyFrame = active.nextKeyFrame;
                    if (nextKeyFrame != null) {
                        this._model.shift(nextKeyFrame, true);
                    }
                }
            }.bind(this));

            //TODO: setActiveKeypoint when changing keyFrames
            let prevKeyFrameHandler = Logger.shortkeyLogDecorator(function() {
                let active = activeTrack();
                if (active && active.trackType === 'interpolation') {
                    let prevKeyFrame = active.prevKeyFrame;
                    if (prevKeyFrame != null) {
                        this._model.shift(prevKeyFrame, true);
                    }
                }
            }.bind(this));

            let nextFilterFrameHandler = Logger.shortkeyLogDecorator(function(e) {
                let frame = filterFrame(1);
                if (frame != null) {
                    this._model.shift(frame, true);
                }
                e.preventDefault();
            }.bind(this));

            let prevFilterFrameHandler = Logger.shortkeyLogDecorator(function(e) {
                let frame = filterFrame(-1);
                if (frame != null) {
                    this._model.shift(frame, true);
                }
                e.preventDefault();
            }.bind(this));

            let forwardHandler = Logger.shortkeyLogDecorator(function() {
                this.forward();
            }.bind(this));

            let backwardHandler = Logger.shortkeyLogDecorator(function() {
                this.backward();
            }.bind(this));

            let playPauseHandler = Logger.shortkeyLogDecorator(function() {
                if (playerModel.playing) {
                    this.pause();
                }
                else {
                    this.play();
                }
                return false;
            }.bind(this));

            let shortkeys = userConfig.shortkeys;

            Mousetrap.bind(shortkeys["next_frame"].value, nextHandler, 'keydown');
            Mousetrap.bind(shortkeys["prev_frame"].value, prevHandler, 'keydown');
            Mousetrap.bind(shortkeys["next_filter_frame"].value, nextFilterFrameHandler, 'keydown');
            Mousetrap.bind(shortkeys["prev_filter_frame"].value, prevFilterFrameHandler, 'keydown');
            Mousetrap.bind(shortkeys["next_key_frame"].value, nextKeyFrameHandler, 'keydown');
            Mousetrap.bind(shortkeys["prev_key_frame"].value, prevKeyFrameHandler, 'keydown');
            Mousetrap.bind(shortkeys["forward_frame"].value, forwardHandler, 'keydown');
            Mousetrap.bind(shortkeys["backward_frame"].value, backwardHandler, 'keydown');
            Mousetrap.bind(shortkeys["play_pause"].value, playPauseHandler, 'keydown');
        }
    }

    zoom(e) {
        let x = e.originalEvent.clientX - this._leftOffset;
        let y = e.originalEvent.clientY - this._topOffset;

        let zoomImageEvent = Logger.addContinuedEvent(Logger.EventType.zoomImage);
        if (e.originalEvent.deltaY < 0) {
            this._model.scale(x, y, 1);
        }
        else {
            this._model.scale(x, y, -1);
        }
        zoomImageEvent.close();
        e.preventDefault();
    }

    fit() {
        this._model.fit();
    }

    frameMouseDown(e) {
        if (e.shiftKey || e.target.id == 'frameContent') {
            this._moving = true;
            this._lastClickX = e.clientX;
            this._lastClickY = e.clientY;
            this._moveFrameEvent = Logger.addContinuedEvent(Logger.EventType.moveImage);
        }
    }

    frameMouseUp() {
        this._moving = false;
        if (this._moveFrameEvent) {
            this._moveFrameEvent.close();
            this._moveFrameEvent = null;
        }
    }

    frameMouseMove(e) {
        if (this._moving) {
            let topOffset = e.clientY - this._lastClickY;
            let leftOffset = e.clientX - this._lastClickX;
            this._lastClickX = e.clientX;
            this._lastClickY = e.clientY;
            this._model.move(topOffset, leftOffset);
        }
    }

    progressMouseDown(e) {
        this._rewinding = true;
        this._rewind(e);
    }

    progressMouseUp() {
        this._rewinding = false;
    }

    progressMouseMove(e) {
        this._rewind(e);
    }

    _rewind(e) {
        if (this._rewinding) {
            let frames = this._model.frames;
            let jumpFrameEvent = Logger.addContinuedEvent(Logger.EventType.jumpFrame);
            let progressWidth = e.target.clientWidth;
            let x = e.clientX - e.target.offsetLeft;
            let percent = x / progressWidth;
            let targetFrame = Math.round((frames.stop - frames.start) * percent);
            this._model.pause();
            this._model.shift(targetFrame + frames.start, true);
            jumpFrameEvent.close();
        }
    }

    changeStep(e) {
        let value = +e.target.value;
        value = Math.max(2, value);
        value = Math.min(100, value);
        this._model.multipleStep = value;
    }

    changeFPS(e) {
        let value = +e.target.value;
        let fpsMap = {
            1: 1,
            2: 5,
            3: 12,
            4: 25,
            5: 50,
            6: 100,
        };
        value = Math.max(1, value);
        value = Math.min(6, value);
        this._model.fps = fpsMap[value];
    }

    changeResetZoom(e) {
        this._model.resetZoom = e.target.checked;
    }

    play() {
        this._model.play();
    }

    pause() {
        this._model.pause();
    }

    next() {
        this._model.shift(1);
        this._model.pause();
    }

    previous() {
        this._model.shift(-1);
        this._model.pause();
    }

    first() {
        this._model.shift(this._model.frames.start, true);
        this._model.pause();
    }

    last() {
        this._model.shift(this._model.frames.stop, true);
        this._model.pause();
    }

    forward() {
        this._model.shift(this._model.multipleStep);
        this._model.pause();
    }

    backward() {
        this._model.shift(-this._model.multipleStep);
        this._model.pause();
    }

    seek(frame) {
        this._model.shift(frame, true);
    }
}


class PlayerView {
    constructor(playerModel, playerController) {
        this._controller = playerController;
        this._playerUI = $('#playerFrame');
        this._playerContentUI = $('#frameContent');
        this._progressUI = $('#playerProgress');
        this._loadingUI = $('#frameLoadingAnim');
        this._playButtonUI = $('#playButton');
        this._pauseButtonUI = $('#pauseButton');
        this._nextButtonUI = $('#nextButton');
        this._prevButtonUI = $('#prevButton');
        this._multipleNextButtonUI = $('#multipleNextButton');
        this._multiplePrevButtonUI = $('#multiplePrevButton');
        this._firstButtonUI = $('#firstButton');
        this._lastButtonUI = $('#lastButton');
        this._playerStepUI = $('#playerStep');
        this._playerSpeedUI = $('#speedSelect');
        this._resetZoomUI = $('#resetZoomBox');
        this._frameNumber = $('#frameNumber');

        $('*').on('mouseup', () => this._controller.frameMouseUp());
        this._playerUI.on('wheel', (e) => this._controller.zoom(e));
        this._playerUI.on('dblclick', () => this._controller.fit());
        this._playerUI.on('mousedown', (e) => this._controller.frameMouseDown(e));
        this._playerUI.on('mousemove', (e) => this._controller.frameMouseMove(e));
        this._progressUI.on('mousedown', (e) => this._controller.progressMouseDown(e));
        this._progressUI.on('mouseup', () => this._controller.progressMouseUp());
        this._progressUI.on('mousemove', (e) => this._controller.progressMouseMove(e));
        this._playButtonUI.on('click', () => this._controller.play());
        this._pauseButtonUI.on('click', () => this._controller.pause());
        this._nextButtonUI.on('click', () => this._controller.next());
        this._prevButtonUI.on('click', () => this._controller.previous());
        this._multipleNextButtonUI.on('click', () => this._controller.forward());
        this._multiplePrevButtonUI.on('click', () => this._controller.backward());
        this._firstButtonUI.on('click', () => this._controller.first());
        this._lastButtonUI.on('click', () => this._controller.last());
        this._playerStepUI.on('change', (e) => this._controller.changeStep(e));
        this._playerSpeedUI.on('change', (e) => this._controller.changeFPS(e));
        this._resetZoomUI.on('change', (e) => this._controller.changeResetZoom(e));
        this._frameNumber.on('change', (e) =>
        {
            if (Number.isInteger(+e.target.value)) {
                this._controller.seek(+e.target.value);
            }
        });
        //Mousetrap.bind(userConfig.shortkeys['focus_to_frame'].value.split(','), () => this._frameNumber.focus(), 'keydown');

        this._progressUI['0'].max = playerModel.frames.stop - playerModel.frames.start;
        this._progressUI['0'].value = 0;

        this._resetZoomUI.prop('checked', playerModel.resetZoom);
        this._playerStepUI.prop('value', playerModel.multipleStep);
        this._playerSpeedUI.prop('value', '4');

        let shortkeys = userConfig.shortkeys;

        this._nextButtonUI.find('polygon').append($(document.createElementNS('http://www.w3.org/2000/svg', 'title'))
            .html(shortkeys["next_frame"].view_value));

        this._prevButtonUI.find('polygon').append($(document.createElementNS('http://www.w3.org/2000/svg', 'title'))
            .html(shortkeys["prev_frame"].view_value));

        this._playButtonUI.find('polygon').append($(document.createElementNS('http://www.w3.org/2000/svg', 'title'))
            .html(shortkeys["play_pause"].view_value));

        this._pauseButtonUI.find('polygon').append($(document.createElementNS('http://www.w3.org/2000/svg', 'title'))
            .html(shortkeys["play_pause"].view_value));

        this._multipleNextButtonUI.find('polygon').append($(document.createElementNS('http://www.w3.org/2000/svg', 'title'))
            .html(shortkeys["forward_frame"].view_value));

        this._multiplePrevButtonUI.find('polygon').append($(document.createElementNS('http://www.w3.org/2000/svg', 'title'))
            .html(shortkeys["backward_frame"].view_value));

        playerModel.subscribe(this);
    }

    onPlayerUpdate(model) {
        let image = model.image;
        let frames = model.frames;
        let geometry = model.geometry;

        // TODO: lazy addition - bugs?


        if (!image) {
            this._loadingUI.removeClass('hidden');
            return;
        }

        this._loadingUI.addClass('hidden');
        this._playerContentUI.css('background-image', 'url(' + '"' + image.src + '"' + ')');

        if (model.playing) {
            this._playButtonUI.addClass('hidden');
            this._pauseButtonUI.removeClass('hidden');
        }
        else {
            this._pauseButtonUI.addClass('hidden');
            this._playButtonUI.removeClass('hidden');
        }

        if (frames.current === frames.start) {
            this._firstButtonUI.addClass('disabledPlayerButton');
            this._prevButtonUI.addClass('disabledPlayerButton');
            this._multiplePrevButtonUI.addClass('disabledPlayerButton');
        }
        else {
            this._firstButtonUI.removeClass('disabledPlayerButton');
            this._prevButtonUI.removeClass('disabledPlayerButton');
            this._multiplePrevButtonUI.removeClass('disabledPlayerButton');
        }

        if (frames.current === frames.stop) {
            this._lastButtonUI.addClass('disabledPlayerButton');
            this._nextButtonUI.addClass('disabledPlayerButton');
            this._playButtonUI.addClass('disabledPlayerButton');
            this._multipleNextButtonUI.addClass('disabledPlayerButton');
        }
        else {
            this._lastButtonUI.removeClass('disabledPlayerButton');
            this._nextButtonUI.removeClass('disabledPlayerButton');
            this._playButtonUI.removeClass('disabledPlayerButton');
            this._multipleNextButtonUI.removeClass('disabledPlayerButton');
        }

        this._progressUI['0'].value = frames.current - frames.start;
        this._playerContentUI.css('width', image.width);
        this._playerContentUI.css('height', image.height);
        this._playerContentUI.css('top', geometry.top);
        this._playerContentUI.css('left', geometry.left);
        this._playerContentUI.css('transform', 'scale(' + geometry.scale + ')');
        this._frameNumber.prop('value', frames.current);
    }
}
