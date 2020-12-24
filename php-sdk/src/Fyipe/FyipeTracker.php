<?php

/**
 * @author bunday
 */

namespace Fyipe;

use stdClass;
use Util\UUID;

class FyipeTracker
{
    /**
     * @var string
     */
    private $apiUrl;

    /**
     * @var string
     */
    private $errorTrackerId;

    /**
     * @var string
     */
    private $errorTrackerKey;

    private $configKeys = ['baseUrl', 'maxTimeline'];
    private $MAX_ITEMS_ALLOWED_IN_STACK = 100;
    private $eventId;
    private $tags = [];
    private $fingerprint;
    private $listenerObj;
    private $utilObj;
    private $event;

    /**
     * FyipeTracker constructor.
     * @param string $apiUrl
     * @param string $errorTrackerId
     * @param string $errorTrackerKey
     * @param array $options
     */
    public function __construct($apiUrl, $errorTrackerId, $errorTrackerKey, $options = [])
    {
        $this->errorTrackerId = $errorTrackerId;
        $this->setApiUrl($apiUrl);
        $this->errorTrackerKey = $errorTrackerKey;
        $this->setUpOptions($options);
        $this->setEventId();
        $this->listenerObj = new FyipeListener(
            $this->getEventId(),
            $this->options
        ); // Initialize Listener for timeline
        $this->utilObj = new Util();

        // initialize exception handler listener
        set_exception_handler('setUpExceptionHandlerListener');

        // initializa error handler listener
        set_error_handler("setUpErrorHandler");
    }

    private function setApiUrl(String $apiUrl): void
    {
        $this->apiUrl = $apiUrl . '/error-tracker/' . $this->errorTrackerId . '/track';
    }

    private function setUpOptions($options)
    {
        foreach ($options as $option) {
            // proceed with current key if it is not in the config keys
            if (in_array($option['key'], $this->configKeys)) {
                // set max timeline properly after checking conditions
                if (
                    $option['key'] == 'maxTimeline' &&
                    ($option['value'] > $this->MAX_ITEMS_ALLOWED_IN_STACK || $option['value'] < 1)
                ) {
                    $this->options['key'] = $this->MAX_ITEMS_ALLOWED_IN_STACK;
                } else {
                    $this->options['key'] = $options['value'];
                }
            }
        }
    }
    private function setEventId()
    {
        $this->eventId = UUID::v4();
    }
    private function getEventId()
    {
        return $this->eventId;
    }
    public function setTag($key, $value)
    {
        if (!(is_string($key) || is_string($value))) {
            throw new \Exception("Invalid Tag");
        }
        $exist = false;
        foreach ($this->tags as $tag) {
            if ($tag->key === $key) {
                // set the round flag
                $exist = true;
                // replace value if it exist
                $tag->value = $value;
                break;
            }
        }
        if (!$exist) {
            // push key and value if it doesnt
            $tag = new stdClass();
            $tag->key = $key;
            $tag->value = $value;
            array_push($this->tags, $tag);
        }
    }
    public function setTags($tags)
    {
        if (!is_array($tags)) {
            throw new \Exception("Invalid Tags");
        }
        foreach ($tags as $element) {
            if (!is_null($element->key) && !is_null($element->value)) {
                $this->setTag($element->key, $element->key);
            }
        }
    }
    private function getTags()
    {
        return $this->tags;
    }
    public function setFingerPrint($key)
    {
        if (!(is_array($key) || is_string($key))) {
            throw new \Exception("Invalid Fingerprint");
        }

        $this->fingerprint = is_array($key) ? $key : [$key];
    }
    private function getFingerprint($errorMessage)
    {
        // if no fingerprint exist currently
        if (sizeof($this->fingerprint) < 1) {
            // set up finger print based on error since none exist
            $this->setFingerprint($errorMessage);
        }
        return $this->fingerprint;
    }
    private function setUpExceptionHandlerListener($exception)
    {
        // construct the error object
        $errorObj = $this->utilObj->getExceptionStackTrace($exception);

        $this->manageErrorObject($errorObj);
    }
    private function setUpErrorHandler($errno, $errstr, $errfile, $errline)
    {

        $errorObj = $this->utilObj->getErrorStackTrace($errno, $errstr, $errfile, $errline);

        $this->manageErrorObject($errorObj);
    }
    private function manageErrorObject($errorObj)
    {
        // log error event
        $content = new stdClass();
        $content->message = $errorObj->message;

        $this->listenerObj->logErrorEvent($content);
        // set the a handled tag
        $this->setTag('handled', 'false');
        // prepare to send to server
        // $this->prepareErrorObject('error', $errorObj);

        // send to the server
        // return this.sendErrorEventToServer();
    }
    public function prepareErrorObject($type, $errorStackTrace) {
        // get current timeline
        $timeline = $this->getTimeline();
        // TODO get device location and details
        // const deviceDetails = this.#utilObj._getUserDeviceDetails();
        $tags = $this->getTags();
        $fingerprint = $this->getFingerprint($errorStackTrace->message); // default fingerprint will be the message from the error stacktrace
        // get event ID
        // Temporary display the state of the error stack, timeline and device details when an error occur
        // prepare the event so it can be sent to the server
        $this->event = new stdClass();
        $this->event->type = $type;
        $this->event->timeline = $timeline;
        $this->event->exception = $errorStackTrace;
        $this->event->eventId = $this->getEventId();
        $this->event->tags = $tags;
        $this->event->fingerprint = $fingerprint;
        $this->event->errorTrackerKey = $this->errorTrackerKey;
        $this->event->sdk = $this->getSDKDetails();
    }
    public function addToTimeline($category, $content, $type) {
        $timelineObj =  new stdClass();
        $timelineObj->category = $category;
        $timelineObj->data = $content;
        $timelineObj->type = $type;
        $this->listenerObj->logCustomTimelineEvent($timelineObj);
    }
    public function getTimeline() {
        return $this->listenerObj->getTimeline();
    }
    private function getSDKDetails() {
        $content = file_get_contents('../../composer.json');
        $content = json_decode($content,true);

        $sdkDetail = new stdClass();
        $sdkDetail->name = $content['name'];
        $sdkDetail->version = $content['version'];
        return $sdkDetail;
    }
}
