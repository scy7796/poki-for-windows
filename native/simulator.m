// Poki MCP CoreSimulator transport. Interoperability sources: ../THIRD_PARTY_NOTICES.md.
// XPC and AX wire contracts follow Meta idb (MIT): https://github.com/facebook/idb.
#import <AppKit/AppKit.h>
#import <Foundation/Foundation.h>
#import <dlfcn.h>
#import <xpc/xpc.h>
#import <unistd.h>
#import <objc/message.h>
#import <UniformTypeIdentifiers/UniformTypeIdentifiers.h>
#import <mach/mach.h>
#import <libproc.h>
#import <signal.h>
#import <math.h>

@interface NSObject (SimulatorPrivate)
+ (id)sharedServiceContextForDeveloperDir:(NSString *)directory error:(NSError **)error;
- (id)defaultDeviceSetWithError:(NSError **)error;
- (NSArray *)availableDevices;
- (NSDictionary *)installedAppsWithError:(NSError **)error;
- (NSUUID *)UDID;
- (id)deviceType;
- (CGSize)mainScreenSize;
- (float)mainScreenScale;
- (unsigned int)lookup:(NSString *)service error:(NSError **)error;
- (void)sendAccessibilityRequestAsync:(id)request completionQueue:(dispatch_queue_t)queue completionHandler:(void (^)(id))handler;
+ (id)requestWithTranslation:(id)translation;
- (void)setRequestType:(unsigned long long)value;
- (void)setClientType:(unsigned long long)value;
- (void)setParameters:(NSDictionary *)value;
- (id)resultData;
- (unsigned long long)error;
- (int)pid;
- (unsigned long long)objectID;
+ (id)sharedInstance;
- (void)setBridgeTokenDelegate:(id)delegate;
- (void)setBridgeDelegateToken:(NSString *)token;
- (id)macPlatformElementFromTranslation:(id)translation;
- (id)objectAtPoint:(CGPoint)point displayId:(unsigned int)display bridgeDelegateToken:(NSString *)token;
- (id)translationApplicationObjectForPid:(int)pid;
- (void)setAccessibilityValue:(id)value;
- (uint64_t)requestType;
+ (NSString *)machServiceName;
- (id)initWithConnectingToPort:(unsigned int)port managingPasteboard:(NSPasteboard *)pasteboard delegate:(id)delegate delegateQueue:(dispatch_queue_t)queue;
- (void)pull;
- (void)push;
@end

static void fail(NSString *message) { @throw [NSException exceptionWithName:@"PokiMCP" reason:message userInfo:nil]; }
static volatile sig_atomic_t hidInterrupted;
static void interruptHID(int signalNumber) { hidInterrupted = signalNumber; }
static void delayHID(double milliseconds) {
  while (milliseconds > 0) {
    if (hidInterrupted) fail(@"Simulator HID input was interrupted.");
    double slice = fmin(milliseconds, 100);
    usleep((useconds_t)(slice * 1000));
    milliseconds -= slice;
  }
}
static void waitFor(dispatch_semaphore_t done, double seconds, NSString *message) {
  if (dispatch_semaphore_wait(done, dispatch_time(DISPATCH_TIME_NOW, seconds * NSEC_PER_SEC))) fail(message);
}
static xpc_object_t encode(id value) {
  if ([value isKindOfClass:NSDictionary.class]) {
    xpc_object_t object = xpc_dictionary_create(NULL, NULL, 0);
    for (NSString *key in value) xpc_dictionary_set_value(object, key.UTF8String, encode(value[key]));
    return object;
  }
  if ([value isKindOfClass:NSArray.class]) {
    xpc_object_t object = xpc_array_create(NULL, 0);
    for (id item in value) xpc_array_append_value(object, encode(item));
    return object;
  }
  if ([value isKindOfClass:NSString.class]) return xpc_string_create([value UTF8String]);
  if ([value isKindOfClass:NSNumber.class]) {
    if (CFGetTypeID((__bridge CFTypeRef)value) == CFBooleanGetTypeID()) return xpc_bool_create([value boolValue]);
    if (strchr("fd", [value objCType][0])) return xpc_double_create([value doubleValue]);
    return xpc_uint64_create([value unsignedLongLongValue]);
  }
  return xpc_null_create();
}

static void (^connectionLost)(void);

static xpc_connection_t connection(id device, NSString *service) {
  xpc_object_t (*endpointFromPort)(mach_port_t, uint64_t, uint64_t) = dlsym(RTLD_DEFAULT, "xpc_endpoint_create_mach_port_4sim");
  void (*enableSim2Host)(xpc_connection_t) = dlsym(RTLD_DEFAULT, "xpc_connection_enable_sim2host_4sim");
  if (!endpointFromPort || !enableSim2Host) fail(@"The installed CoreSimulator lacks the simulator XPC endpoint API.");
  NSError *error = nil;
  unsigned int port = [device lookup:service error:&error];
  if (!port) fail(error.description ?: @"Simulator service was not found.");
  xpc_object_t endpoint = endpointFromPort(port, 0, 0);
  xpc_connection_t channel = xpc_connection_create_from_endpoint(endpoint);
  enableSim2Host(channel);
  xpc_connection_set_target_queue(channel, dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0));
  xpc_connection_set_event_handler(channel, ^(xpc_object_t event) { if (xpc_get_type(event) == XPC_TYPE_ERROR && connectionLost) connectionLost(); });
  xpc_connection_resume(channel);
  return channel;
}

static NSDictionary *envelope(NSString *service, NSString *type, NSDictionary *payload, BOOL barrier) {
  return @{ @"messageType": type, @"featureIdentifier": service, @"isBarrier": @(barrier), @"payload": payload };
}

static BOOL answers(xpc_connection_t channel, NSString *service) {
  dispatch_semaphore_t done = dispatch_semaphore_create(0);
  __block BOOL answered = NO;
  xpc_connection_send_message_with_reply(channel, encode(envelope(service, @"IndigoKeyboardButtonEvent", @{ @"usageCode": @0, @"state": @2 }, YES)), dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^(xpc_object_t reply) {
    answered = xpc_get_type(reply) != XPC_TYPE_ERROR;
    dispatch_semaphore_signal(done);
  });
  waitFor(done, 5, @"Simulator HID liveness probe timed out; wait for the simulator to finish booting.");
  return answered;
}

static void probe(xpc_connection_t channel, NSString *service) {
  if (!answers(channel, service)) fail(@"Simulator HID service rejected the connection.");
  usleep(200000);
}

static void keyboard(xpc_connection_t channel, NSString *service, uint64_t code, BOOL down) {
  xpc_connection_send_message(channel, encode(envelope(service, @"IndigoKeyboardButtonEvent", @{ @"usageCode": @(code), @"state": @(down ? 1 : 2) }, NO)));
}

static void keypress(xpc_connection_t channel, NSString *service, uint64_t code, BOOL command) {
  if (command) { keyboard(channel, service, 227, YES); usleep(100000); }
  keyboard(channel, service, code, YES); usleep(100000); keyboard(channel, service, code, NO);
  usleep(100000);
  if (command) keyboard(channel, service, 227, NO);
  usleep(100000);
}

static xpc_connection_t axChannel;
static BOOL axHitTesting;
static NSMutableDictionary *translations;
static id axSend(id request) {
  dispatch_semaphore_t done = dispatch_semaphore_create(0);
  __block id response;
  NSError *archiveError;
  NSData *archive = [NSKeyedArchiver archivedDataWithRootObject:request requiringSecureCoding:YES error:&archiveError];
  if (!archive) fail(archiveError.description);
  xpc_object_t payload = xpc_dictionary_create(NULL, NULL, 0);
  xpc_dictionary_set_data(payload, "translatorRequest", archive.bytes, archive.length);
  xpc_object_t message = xpc_dictionary_create(NULL, NULL, 0);
  xpc_dictionary_set_string(message, "SimAccessibility_PayloadClassName", "AXPTranslatorRequest");
  xpc_dictionary_set_value(message, "SimAccessibility_Payload", payload);
  xpc_connection_send_message_with_reply(axChannel, message, dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^(xpc_object_t reply) {
    if (xpc_get_type(reply) == XPC_TYPE_DICTIONARY) {
      xpc_object_t body = xpc_dictionary_get_value(reply, "SimAccessibility_Payload");
      size_t length = 0;
      const void *bytes = body ? xpc_dictionary_get_data(body, "translatorResponse", &length) : NULL;
      if (bytes) response = [NSKeyedUnarchiver unarchivedObjectOfClass:NSClassFromString(@"AXPTranslatorResponse") fromData:[NSData dataWithBytes:bytes length:length] error:nil];
    }
    dispatch_semaphore_signal(done);
  });
  waitFor(done, 8, @"Simulator accessibility request timed out.");
  if (!response) fail(@"Simulator accessibility returned no decoded response.");
  uint64_t code = ((uint64_t (*)(id, SEL))objc_msgSend)(response, @selector(error));
  if (code && !axHitTesting && ![[response resultData] isKindOfClass:NSDictionary.class]) fail([NSString stringWithFormat:@"Simulator accessibility request %llu error: %llu", (unsigned long long)[request requestType], (unsigned long long)code]);
  return response;
}
static id axRequest(id device, id translation, uint64_t kind, NSDictionary *parameters) {
  id request = [NSClassFromString(@"AXPTranslatorRequest") requestWithTranslation:translation];
  if (!request) fail(@"AccessibilityPlatformTranslation request API is unavailable.");
  [request setRequestType:kind]; [request setClientType:0]; [request setParameters:parameters];
  return [axSend(request) resultData];
}

@interface AXDelegate : NSObject
@end
@implementation AXDelegate
- (id (^)(id))accessibilityTranslationDelegateBridgeCallbackWithToken:(NSString *)token { return ^id(id request) { return axSend(request); }; }
- (CGRect)accessibilityTranslationConvertPlatformFrameToSystem:(CGRect)rect withToken:(NSString *)token { return rect; }
- (id)accessibilityTranslationRootParentWithToken:(NSString *)token { return nil; }
@end

static id foregroundTranslation(id device) {
  id translation = axRequest(device, [NSClassFromString(@"AXPTranslationObject") new], 4, @{ @"displayId": @0 });
  if (translation) return translation;
  // A fresh SpringBoard can answer the window-server query with nil. Resolve
  // the application from an actual accessibility hit test on its visible UI.
  id translator = [NSClassFromString(@"AXPTranslator") sharedInstance];
  __attribute__((objc_precise_lifetime)) AXDelegate *delegate = [AXDelegate new];
  [translator setBridgeTokenDelegate:delegate];
  CGSize pixels = [[device deviceType] mainScreenSize];
  float scale = [[device deviceType] mainScreenScale];
  // A point with nothing on it answers the hit test with an error, so a blank centre must not end the read.
  axHitTesting = YES;
  for (NSNumber *height in @[@0.5, @0.1, @0.25, @0.75, @0.9]) {
    id hit = [translator objectAtPoint:CGPointMake(pixels.width / scale / 2, pixels.height / scale * height.doubleValue) displayId:0 bridgeDelegateToken:@"poki-mcp"];
    if (hit) { translation = [translator translationApplicationObjectForPid:[hit pid]]; break; }
  }
  axHitTesting = NO;
  if (!translation) fail(@"The simulator returned no foreground accessibility application.");
  return translation;
}

static id plain(id value) {
  if (!value || value == NSNull.null) return NSNull.null;
  if ([value isKindOfClass:NSString.class] || [value isKindOfClass:NSNumber.class]) return value;
  return [value description];
}

static NSDictionary *readElement(id device, id translation, NSMutableSet *seen, NSUInteger depth, NSMutableArray *flat, CFAbsoluteTime deadline) {
  if (depth > 45 || flat.count > 1500 || CFAbsoluteTimeGetCurrent() > deadline) fail(@"Simulator accessibility tree exceeded the traversal limit.");
  NSString *identity = [NSString stringWithFormat:@"%d:%llu", [translation pid], [translation objectID]];
  if ([seen containsObject:identity]) return nil;
  [seen addObject:identity];
  translations[identity] = translation;
  NSDictionary *values = axRequest(device, translation, 5, @{ @"attributes": @[@6, @7, @8, @21, @25, @27, @28, @30, @32, @33, @38, @42, @45, @46, @47, @51, @53] });
  if (![values isKindOfClass:NSDictionary.class]) fail(@"Simulator accessibility returned no attributes.");
  NSRect frame = [values[@21] isKindOfClass:NSValue.class] ? [values[@21] rectValue] : NSZeroRect;
  NSMutableDictionary *element = [@{ @"id": identity, @"pid": @([translation pid]), @"depth": @(depth),
    @"bundle_id": plain(values[@6]), @"class": plain(values[@7]), @"type": plain(values[@45]), @"subrole": plain(values[@51]), @"role_description": plain(values[@46]),
    @"label": plain(values[@33]), @"value": plain(values[@53]), @"identifier": plain(values[@25]), @"placeholder": plain(values[@42]),
    @"enabled": plain(values[@27]), @"focused": plain(values[@28]), @"selected": plain(values[@30]), @"visible": plain(values[@32]),
    @"x": @(frame.origin.x), @"y": @(frame.origin.y), @"width": @(frame.size.width), @"height": @(frame.size.height) } mutableCopy];
  if ([values[@47] isKindOfClass:NSValue.class]) { NSRange range = [values[@47] rangeValue]; element[@"selected_range"] = @{ @"location": @(range.location), @"length": @(range.length) }; }
  if (values[@38]) element[@"character_count"] = plain(values[@38]);
  [flat addObject:element];
  NSMutableArray *children = NSMutableArray.array;
  for (id child in values[@8]) { NSDictionary *item = readElement(device, child, seen, depth + 1, flat, deadline); if (item) [children addObject:item]; }
  element[@"children"] = children;
  return element;
}

static void clearFocusedText(id device, xpc_connection_t channel, NSString *service) {
  dlopen("/System/Library/PrivateFrameworks/AccessibilityPlatformTranslation.framework/AccessibilityPlatformTranslation", RTLD_NOW | RTLD_GLOBAL);
  axChannel = connection(device, @"com.apple.CoreSimulator.accessibility");
  translations = NSMutableDictionary.dictionary;
  id root = foregroundTranslation(device);
  NSMutableArray *elements = NSMutableArray.array;
  readElement(device, root, NSMutableSet.set, 0, elements, CFAbsoluteTimeGetCurrent() + 35);
  NSDictionary *field = nil;
  for (NSDictionary *element in elements) if (element[@"focused"] != NSNull.null && [element[@"focused"] boolValue] && ([element[@"type"] isEqual:@15] || [element[@"type"] isEqual:@17])) {
    if (field) fail(@"More than one text field is focused."); field = element;
  }
  if (!field) fail(@"No focused text field is exposed by accessibility; tap the field first.");
  if ([field[@"subrole"] isEqual:@5]) fail(@"Secure text fields require human input.");
  id handle = translations[field[@"id"]];
  for (int attempt = 0; attempt < 5; attempt++) {
    keypress(channel, service, 4, YES);
    NSDictionary *values = axRequest(device, handle, 5, @{ @"attributes": @[@28, @42, @47, @53] });
    if (![values[@28] boolValue]) fail(@"The text field lost focus while clearing it; no text was pasted.");
    if (![values[@47] isKindOfClass:NSValue.class]) fail(@"The field did not expose its selection; cannot verify clearing it.");
    NSRange selected = [values[@47] rangeValue];
    NSString *value = values[@53];
    if (selected.length == 0 && selected.location == 0 && (!value || [value isEqual:@""] || [value isEqual:values[@42]])) return;
    if (selected.length > 0) keypress(channel, service, 42, NO);
    else keypress(channel, service, 41, NO);
    // An IME can consume Select All while marked text is active. Escape cancels
    // that composition; the next selection must prove the field can be cleared.
  }
  fail(@"The focused field could not be verified empty; no text was pasted.");
}

@interface ClipboardDelegate : NSObject
@property dispatch_semaphore_t active;
@property dispatch_semaphore_t applied;
@property NSError *error;
@end
@implementation ClipboardDelegate
- (void)simPasteboardDidBecomeActive:(id)interface { dispatch_semaphore_signal(self.active); }
- (BOOL)simPasteboardShouldApplySnapshot:(id)interface fromHost:(id)host generation:(long long)generation toPasteboard:(id)pasteboard { return YES; }
- (void)simPasteboardDidApplySnapshot:(id)interface fromHost:(id)host incomingGeneration:(long long)incoming toPasteboard:(id)pasteboard atGeneration:(long long)generation { dispatch_semaphore_signal(self.applied); }
- (void)simPasteboardErrorApplyingSnapshot:(id)interface fromHost:(id)host generation:(long long)generation error:(NSError *)error toPasteboard:(id)pasteboard { self.error = error; dispatch_semaphore_signal(self.applied); }
@end

// Sends one batch, and releases whatever it still holds if the batch ends early.
static NSDictionary *sendHID(xpc_connection_t channel, NSString *service, NSArray *events) {
  if (![events isKindOfClass:NSArray.class] || events.count > 10000) fail(@"Expected at most 10000 HID events.");
  double duration = 0;
  for (NSDictionary *event in events) {
    double delay = [event[@"delay_ms"] doubleValue];
    if (!isfinite(delay) || delay < 0 || delay > 60000) fail(@"delay_ms is outside 0...60000.");
    duration += delay;
  }
  if (duration > 70000) fail(@"A HID batch cannot exceed 70000 ms.");
  NSMutableDictionary *held = NSMutableDictionary.dictionary;
  NSMutableDictionary *contact = nil;
  @try {
    for (NSDictionary *event in events) {
      if (hidInterrupted) fail(@"Simulator HID input was interrupted.");
      delayHID([event[@"delay_ms"] doubleValue]);
      NSString *type = event[@"messageType"];
      NSDictionary *payload = event[@"payload"];
      if (!type) continue;
      xpc_connection_send_message(channel, encode(envelope(service, type, payload, NO)));
      if ([type isEqual:@"IndigoDigitizerEvent"]) contact = [payload[@"eventType"] intValue] == 2 ? nil : [payload mutableCopy];
      else {
        NSString *key = [NSString stringWithFormat:@"%@:%@:%@", type, payload[@"usagePage"] ?: @0, payload[@"usageCode"]];
        if ([payload[@"state"] intValue] == 1) held[key] = event;
        else if ([payload[@"state"] intValue] == 2) [held removeObjectForKey:key];
      }
    }
    dispatch_semaphore_t sent = dispatch_semaphore_create(0);
    xpc_connection_send_barrier(channel, ^{ dispatch_semaphore_signal(sent); });
    waitFor(sent, 5, @"Simulator HID send barrier timed out.");
    return @{ @"sent": @YES, @"screen_change_verified": @NO, @"events": @(events.count) };
  } @finally {
    for (NSDictionary *event in held.allValues) {
      NSMutableDictionary *payload = [event[@"payload"] mutableCopy]; payload[@"state"] = @2;
      xpc_connection_send_message(channel, encode(envelope(service, event[@"messageType"], payload, NO)));
    }
    if (contact) { contact[@"eventType"] = @2; xpc_connection_send_message(channel, encode(envelope(service, @"IndigoDigitizerEvent", contact, NO))); }
    if (held.count || contact) {
      dispatch_semaphore_t released = dispatch_semaphore_create(0);
      xpc_connection_send_barrier(channel, ^{ dispatch_semaphore_signal(released); });
      dispatch_semaphore_wait(released, dispatch_time(DISPATCH_TIME_NOW, 2 * NSEC_PER_SEC));
    }
  }
}

static void writeLine(NSDictionary *value) {
  NSMutableData *output = [[NSJSONSerialization dataWithJSONObject:value options:0 error:nil] mutableCopy];
  [output appendBytes:"\n" length:1];
  [NSFileHandle.fileHandleWithStandardOutput writeData:output];
}

// Each new connection makes the simulator create six virtual input devices, and the more it has
// created, the longer the next ones take. A tap sent over a connection that closes before they are up
// is lost with no error, so one connection stays open while input keeps coming, and the first batch
// waits out the setup. Requests are one JSON line each and each gets one reply line. End of input
// closes the session. Exit status 75 means nothing from the current request was sent.
enum { nothingSent = 75 };
static const useconds_t inputSetupMicroseconds = 800000;
static volatile sig_atomic_t sendingHID;

static int hidSession(id device) {
  NSString *service = @"com.apple.coredevice.feature.remote.hid.digitizer";
  signal(SIGTERM, interruptHID);
  connectionLost = ^{
    fprintf(stderr, "The simulator closed its input connection.\n");
    _exit(sendingHID ? 1 : nothingSent);
  };
  xpc_connection_t channel = connection(device, service);
  if (!answers(channel, service)) fail(@"Simulator HID service rejected the connection.");
  usleep(inputSetupMicroseconds);
  writeLine(@{ @"ready": @YES });
  char *line = NULL;
  size_t capacity = 0;
  ssize_t length;
  while (!hidInterrupted && (length = getline(&line, &capacity, stdin)) > 0) {
    @autoreleasepool {
      NSDictionary *request = [NSJSONSerialization JSONObjectWithData:[NSData dataWithBytes:line length:length] options:0 error:nil];
      if (!answers(channel, service)) _exit(nothingSent);
      sendingHID = 1;
      writeLine(sendHID(channel, service, request[@"events"]));
      sendingHID = 0;
    }
  }
  connectionLost = nil;
  xpc_connection_cancel(channel);
  return 0;
}

static NSString *sessionDevice;

static int execute(void) {
  @autoreleasepool {
    @try {
      NSDictionary *args = sessionDevice ? @{ @"op": @"hid_session", @"id": sessionDevice } : [NSJSONSerialization JSONObjectWithData:[NSFileHandle.fileHandleWithStandardInput readDataToEndOfFile] options:0 error:nil];
      if (!args || !args[@"op"]) fail(@"Expected JSON containing op.");
      if ([args[@"op"] isEqual:@"image_types"]) {
        BOOL containsImage = NO;
        for (NSString *type in args[@"types"]) if ([[UTType typeWithIdentifier:type] conformsToType:UTTypeImage]) containsImage = YES;
        NSData *output = [NSJSONSerialization dataWithJSONObject:@{ @"contains_image": @(containsImage) } options:0 error:nil];
        [NSFileHandle.fileHandleWithStandardOutput writeData:output]; return 0;
      }
      if (!args[@"id"]) fail(@"Expected simulator id.");
      dlopen("/Library/Developer/PrivateFrameworks/CoreSimulator.framework/CoreSimulator", RTLD_NOW | RTLD_GLOBAL);
      NSError *error = nil;
      NSString *developer = args[@"developer_dir"] ?: NSProcessInfo.processInfo.environment[@"DEVELOPER_DIR"];
      if (!developer) {
        NSTask *selection = [NSTask new]; selection.executableURL = [NSURL fileURLWithPath:@"/usr/bin/xcode-select"]; selection.arguments = @[@"-p"];
        NSPipe *output = [NSPipe pipe]; selection.standardOutput = output; selection.standardError = [NSFileHandle fileHandleWithNullDevice];
        if (![selection launchAndReturnError:&error]) fail(error.description);
        NSData *data = [output.fileHandleForReading readDataToEndOfFile]; [selection waitUntilExit];
        developer = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
        developer = [developer stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
        if (selection.terminationStatus != 0 || !developer.length) fail(@"Select an Xcode installation with xcode-select first.");
      }
      id context = [NSClassFromString(@"SimServiceContext") sharedServiceContextForDeveloperDir:developer error:&error];
      id set = [context defaultDeviceSetWithError:&error];
      id device = nil;
      for (id candidate in [set availableDevices]) if ([[[candidate UDID] UUIDString] caseInsensitiveCompare:args[@"id"]] == NSOrderedSame) { device = candidate; break; }
      if (!device) fail(error.description ?: @"Simulator UDID not found.");
      NSString *op = args[@"op"];
      id result;
      if ([op isEqual:@"info"]) {
        CGSize size = [[device deviceType] mainScreenSize];
        float scale = [[device deviceType] mainScreenScale];
        result = @{ @"pixel_width": @(size.width), @"pixel_height": @(size.height), @"scale": @(scale), @"width": @(size.width / scale), @"height": @(size.height / scale) };
      } else if ([op isEqual:@"hid_session"]) {
        return hidSession(device);
      } else if ([op isEqual:@"rotate"]) {
        NSNumber *orientation = @{ @"portrait": @1, @"portrait_upside_down": @2, @"landscape_right": @3, @"landscape_left": @4 }[args[@"orientation"]];
        if (!orientation) fail(@"Unknown orientation.");
        unsigned int port = [device lookup:@"PurpleWorkspacePort" error:&error];
        if (!port) fail(error.description ?: @"Simulator rotation port unavailable.");
        uint32_t words[28] = {0};
        words[0] = 0x13; words[1] = 108; words[2] = port; words[5] = 0x7b;
        words[6] = 50 | 0x20000; words[18] = 4; words[19] = orientation.unsignedIntValue;
        kern_return_t status = mach_msg((mach_msg_header_t *)words, MACH_SEND_MSG | MACH_SEND_TIMEOUT, 108, 0, MACH_PORT_NULL, 2000, MACH_PORT_NULL);
        mach_port_deallocate(mach_task_self(), port);
        if (status != KERN_SUCCESS) fail([NSString stringWithUTF8String:mach_error_string(status)]);
        result = @{ @"sent": @YES, @"screen_change_verified": @NO, @"orientation": args[@"orientation"] };
      } else if ([op isEqual:@"ax"] || [op isEqual:@"ax_type_text"]) {
        dlopen("/System/Library/PrivateFrameworks/AccessibilityPlatformTranslation.framework/AccessibilityPlatformTranslation", RTLD_NOW | RTLD_GLOBAL);
        axChannel = connection(device, @"com.apple.CoreSimulator.accessibility");
        translations = NSMutableDictionary.dictionary;
        id translation = foregroundTranslation(device);
        NSMutableArray *elements = NSMutableArray.array;
        NSDictionary *tree = readElement(device, translation, NSMutableSet.set, 0, elements, CFAbsoluteTimeGetCurrent() + 35);
        NSMutableArray *flat = NSMutableArray.array;
        for (NSDictionary *element in elements) { NSMutableDictionary *copy = [element mutableCopy]; [copy removeObjectForKey:@"children"]; [flat addObject:copy]; }
        if ([op isEqual:@"ax_type_text"]) {
          NSDictionary *field = nil;
          for (NSDictionary *element in flat) if (element[@"focused"] != NSNull.null && [element[@"focused"] boolValue] && ([element[@"type"] isEqual:@15] || [element[@"type"] isEqual:@17])) { if (field) fail(@"More than one text field is focused."); field = element; }
          if (!field) fail(@"No focused text field is exposed by accessibility; tap the field first.");
          if ([field[@"subrole"] isEqual:@5]) fail(@"Secure text fields require human input.");
          id handle = translations[field[@"id"]];
          NSDictionary *values = axRequest(device, handle, 5, @{ @"attributes": @[@38, @47, @53] });
          NSString *existing = [values[@38] unsignedLongLongValue] == 0 ? @"" : values[@53];
          if (![existing isKindOfClass:NSString.class]) fail(@"The text field did not expose its current text.");
          NSRange selection = NSMakeRange(existing.length, 0);
          if ([values[@47] isKindOfClass:NSValue.class]) selection = [values[@47] rangeValue];
          if (NSMaxRange(selection) > existing.length) fail(@"The text field returned an invalid selected range.");
          NSString *replacement = [args[@"clear"] boolValue] ? (args[@"text"] ?: @"") : [existing stringByReplacingCharactersInRange:selection withString:args[@"text"] ?: @""];
          id translator = [NSClassFromString(@"AXPTranslator") sharedInstance];
          AXDelegate *delegate = [AXDelegate new];
          [translator setBridgeTokenDelegate:delegate];
          [handle setBridgeDelegateToken:@"poki-mcp"];
          id element = [translator macPlatformElementFromTranslation:handle];
          if (!element) fail(@"The focused field has no writable accessibility element.");
          [element setAccessibilityValue:replacement];
          NSDictionary *after = axRequest(device, handle, 5, @{ @"attributes": @[@38, @53] });
          NSString *actual = [after[@38] unsignedLongLongValue] == 0 ? @"" : after[@53];
          if (![replacement isEqual:actual]) fail(@"Accessibility text write did not match its readback.");
          if ([args[@"submit"] boolValue]) {
            NSString *service = @"com.apple.coredevice.feature.remote.hid.digitizer";
            xpc_connection_t channel = connection(device, service); probe(channel, service); keypress(channel, service, 40, NO); xpc_connection_cancel(channel);
          }
          result = @{ @"sent": @YES, @"text_verified": @YES, @"source": @"accessibility", @"clipboard_changed": @NO };
        } else {
          id bundle = tree[@"bundle_id"] ?: NSNull.null, label = tree[@"label"] ?: NSNull.null;
          NSString *identitySource = @"accessibility";
          if (bundle == NSNull.null) {
            char buffer[PROC_PIDPATHINFO_MAXSIZE] = {0};
            if (proc_pidpath([translation pid], buffer, sizeof(buffer)) > 0) {
              NSString *executable = [[NSString stringWithUTF8String:buffer] stringByResolvingSymlinksInPath];
              NSDictionary *installed = [device installedAppsWithError:&error];
              for (NSString *identifier in installed) {
                NSDictionary *app = installed[identifier];
                NSString *path = [app[@"Path"] isKindOfClass:NSURL.class] ? [app[@"Path"] path] : app[@"Path"];
                if (![path isKindOfClass:NSString.class]) continue;
                path = [path stringByResolvingSymlinksInPath];
                if (![executable hasPrefix:[path stringByAppendingString:@"/"]]) continue;
                bundle = identifier; label = app[@"CFBundleDisplayName"] ?: app[@"CFBundleName"] ?: identifier;
                identitySource = @"accessibility PID matched installed application path"; break;
              }
            }
          }
          result = @{ @"source": @"accessibility", @"identity_source": identitySource, @"pid": @([translation pid]), @"bundle_id": bundle, @"label": label, @"elements": flat, @"tree": tree };
        }
      } else if ([op isEqual:@"clipboard"] || [op isEqual:@"paste_text"]) {
        dlopen("/Library/Developer/PrivateFrameworks/CoreSimulator.framework/Versions/A/Frameworks/SimPasteboardPlus.framework/SimPasteboardPlus", RTLD_NOW | RTLD_GLOBAL);
        Class listenerClass = NSClassFromString(@"_TtC17SimPasteboardPlus30SimPasteboardInterfaceListener");
        Class interfaceClass = NSClassFromString(@"_TtC17SimPasteboardPlus22SimPasteboardInterface");
        if (!listenerClass || !interfaceClass) fail(@"Modern CoreSimulator pasteboard API is unavailable.");
        unsigned int port = [device lookup:[listenerClass machServiceName] error:&error];
        if (!port) fail(error.description ?: @"Simulator pasteboard service unavailable.");
        NSPasteboard *pasteboard = [NSPasteboard pasteboardWithUniqueName];
        ClipboardDelegate *delegate = [ClipboardDelegate new];
        delegate.active = dispatch_semaphore_create(0); delegate.applied = dispatch_semaphore_create(0);
        id interface = [[interfaceClass alloc] initWithConnectingToPort:port managingPasteboard:pasteboard delegate:delegate delegateQueue:dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0)];
        waitFor(delegate.active, 10, @"Simulator pasteboard did not connect.");
        [interface pull];
        waitFor(delegate.applied, 10, @"Simulator pasteboard did not return a snapshot.");
        if (delegate.error) fail(delegate.error.description);
        if ([op isEqual:@"paste_text"]) {
          NSString *text = args[@"text"] ?: @"";
          NSString *service = @"com.apple.coredevice.feature.remote.hid.digitizer";
          xpc_connection_t channel = connection(device, service);
          @try {
            probe(channel, service);
            if ([args[@"clear"] boolValue]) clearFocusedText(device, channel, service);
            if (text.length) {
              [pasteboard clearContents]; [pasteboard setString:text forType:NSPasteboardTypeString]; [interface push];
              usleep(300000);
              keypress(channel, service, 25, YES);
              usleep(500000);
            }
            result = @{ @"sent": @YES, @"screen_change_verified": @NO, @"clipboard_changed": text.length ? @YES : @NO };
          } @finally {
            xpc_connection_cancel(channel);
          }
        } else {
          BOOL image = NO;
          for (NSPasteboardType type in pasteboard.types) if ([[UTType typeWithIdentifier:type] conformsToType:UTTypeImage]) image = YES;
          result = @{ @"text": [pasteboard stringForType:NSPasteboardTypeString] ?: @"", @"contains_image": @(image), @"types": pasteboard.types ?: @[] };
        }
        [pasteboard releaseGlobally];
      } else fail(@"Unknown simulator operation.");
      NSData *output = [NSJSONSerialization dataWithJSONObject:result options:0 error:&error];
      if (!output) fail(error.description);
      [NSFileHandle.fileHandleWithStandardOutput writeData:output];
      return 0;
    } @catch (NSException *error) { fprintf(stderr, "%s\n", error.reason.UTF8String); return 1; }
  }
}

int main(int argc, char **argv) {
  if (argc == 3 && !strcmp(argv[1], "--hid-session")) sessionDevice = @(argv[2]);
  dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{ exit(execute()); });
  dispatch_main();
}
