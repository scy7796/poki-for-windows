#import <UIKit/UIKit.h>
#import "InProcess.h"

static void Write(NSString *name, id object) {
    NSURL *dir = [NSFileManager.defaultManager URLsForDirectory:NSDocumentDirectory inDomains:NSUserDomainMask].firstObject;
    NSData *data = [object isKindOfClass:NSString.class] ? [object dataUsingEncoding:NSUTF8StringEncoding]
        : [NSJSONSerialization dataWithJSONObject:object options:NSJSONWritingPrettyPrinted | NSJSONWritingSortedKeys error:nil];
    [data writeToURL:[dir URLByAppendingPathComponent:name] atomically:YES];
}

/// Reads the front app with Poki's in-process code. "read" writes its tree; "field" also finds the first
/// text field in it, taps it, types, and reads the tree and the keyboard focus again. "cycle" is "field"
/// after the session was closed (as Poki does when idle) and opened again: a touch in between must be
/// refused, and the new session must have a new generation.
static NSDictionary *Run(NSString *mode, NSString *tag, NSString *text) {
    NSMutableDictionary *out = [NSMutableDictionary dictionary];
    out[@"front"] = [PKInProcess.shared frontApp];
    NSString *code;
    NSString *before = [PKInProcess.shared sourceXML:NULL code:&code];
    if (code) out[@"source_code"] = code;
    Write([tag stringByAppendingString:@".xml"], before ?: @"");
    if ([mode isEqualToString:@"cycle"]) {
        // Progress is written after each step, so a crash or a hang says how far it got.
        void (^progress)(NSString *) = ^(NSString *step) { out[@"progress"] = step; Write([tag stringByAppendingString:@"-progress.json"], out); };
        progress(@"read");
        out[@"close"] = [PKInProcess.shared close];
        progress(@"closed");
        // A touch after close must not go through the closed session: it is refused, or it goes
        // through a session opened for it (a new generation), as touch prepares one itself.
        uint64_t beforeTouch = [PKInProcess.shared generation];
        PKOutcome *refused = [PKInProcess.shared touch:@[@[[PKTouchPoint at:CGPointMake(10, 10) offset:0], [PKTouchPoint at:CGPointMake(10, 10) offset:0.05]]] timeout:2];
        out[@"closed_touch"] = @{@"delivery": @(refused.delivery), @"code": refused.code ?: @"", @"generation_before": @(beforeTouch), @"generation_after": @([PKInProcess.shared generation])};
        progress(@"touch refused");
        [NSThread sleepForTimeInterval:2];
        out[@"prepare2"] = [PKInProcess.shared prepare];
        progress(@"reopened");
        out[@"front2"] = [PKInProcess.shared frontApp];
        progress(@"front read");
        before = [PKInProcess.shared sourceXML:NULL code:&code];
        if (code) out[@"source_code2"] = code;
        Write([tag stringByAppendingString:@"-reopened.xml"], before ?: @"");
        if (!before) return out;
    } else if (![mode isEqualToString:@"field"] || !before) return out;
    NSRegularExpression *re = [NSRegularExpression regularExpressionWithPattern:@"<XCUIElementTypeTextField[^>]*x=\"(\\d+)\" y=\"(\\d+)\" width=\"(\\d+)\" height=\"(\\d+)\"" options:0 error:nil];
    NSTextCheckingResult *m = [re firstMatchInString:before options:0 range:NSMakeRange(0, before.length)];
    if (!m) { out[@"field"] = @"none"; return out; }
    double v[4];
    for (int i = 0; i < 4; i++) v[i] = [[before substringWithRange:[m rangeAtIndex:i + 1]] doubleValue];
    CGPoint c = CGPointMake(v[0] + v[2] / 2, v[1] + v[3] / 2);
    // The tree's frames are relative to the front app's part of the screen (viewport); a touch is
    // on the whole screen, as InProcessWDA moves it.
    CGRect viewport = PKInProcess.shared.viewport;
    if (!CGRectIsNull(viewport)) {
        out[@"viewport"] = NSStringFromCGRect(viewport);
        c.x += viewport.origin.x; c.y += viewport.origin.y;
    }
    PKOutcome *tap = [PKInProcess.shared touch:@[@[[PKTouchPoint at:c offset:0], [PKTouchPoint at:c offset:0.05]]] timeout:5];
    out[@"tap"] = @(tap.delivery);
    [NSThread sleepForTimeInterval:1];
    NSInteger times = MAX(1, [NSUserDefaults.standardUserDefaults integerForKey:@"times"]);
    PKOutcome *typed = nil;
    for (NSInteger i = 0; i < times; i++) { typed = [PKInProcess.shared type:text timeout:5]; [NSThread sleepForTimeInterval:0.5]; }
    out[@"type"] = @(typed.delivery);
    [NSThread sleepForTimeInterval:1];
    NSDictionary *focus;
    NSString *after = [PKInProcess.shared sourceXML:&focus code:&code];
    Write([tag stringByAppendingString:@"-after.xml"], after ?: @"");
    if (focus) out[@"focus"] = focus;
    return out;
}

/// Opens, switches and ends apps with Poki's in-process code: launch the fixture, launch Settings,
/// activate the fixture (the same process comes back), launch it again (a new process), terminate it.
static NSDictionary *Apps(NSString *fixture) {
    NSMutableArray *steps = [NSMutableArray array];
    void (^step)(NSString *, NSString *) = ^(NSString *action, NSString *bundle) {
        NSTimeInterval t = NSProcessInfo.processInfo.systemUptime;
        NSString *code = [PKInProcess.shared app:bundle action:action];
        [NSThread sleepForTimeInterval:1];
        NSDictionary *front = [PKInProcess.shared frontApp];
        [steps addObject:@{@"action": action, @"bundle": bundle, @"code": code ?: @"", @"seconds": @(NSProcessInfo.processInfo.systemUptime - t),
                           @"front": front[@"bundleId"] ?: @"", @"front_pid": front[@"pid"] ?: @0}];
    };
    step(@"launch", fixture);
    step(@"launch", @"com.apple.Preferences");
    step(@"activate", fixture);
    step(@"launch", fixture);
    step(@"terminate", fixture);
    return @{@"steps": steps};
}

@interface SceneDelegate : UIResponder <UIWindowSceneDelegate>
@property (nonatomic) UIWindow *window;
@end

@implementation SceneDelegate
- (void)scene:(UIScene *)scene willConnectToSession:(UISceneSession *)session options:(UISceneConnectionOptions *)options {
    self.window = [[UIWindow alloc] initWithWindowScene:(UIWindowScene *)scene];
    UIViewController *vc = [UIViewController new];
    vc.view.backgroundColor = UIColor.systemBackgroundColor;
    UILabel *label = [[UILabel alloc] initWithFrame:CGRectMake(20, 120, 300, 40)];
    label.text = @"In-process check";
    [vc.view addSubview:label];
    self.window.rootViewController = vc;
    [self.window makeKeyAndVisible];
}
@end

@interface AppDelegate : UIResponder <UIApplicationDelegate>
@end

@implementation AppDelegate
- (BOOL)application:(UIApplication *)application didFinishLaunchingWithOptions:(NSDictionary *)options {
    NSUserDefaults *args = NSUserDefaults.standardUserDefaults;
    NSString *mode = [args stringForKey:@"mode"] ?: @"read", *tag = [args stringForKey:@"tag"] ?: mode;
    NSString *text = [args stringForKey:@"text"] ?: @"ESP173 读屏";
    double delay = [args doubleForKey:@"delay"];
    dispatch_async(dispatch_queue_create("check", DISPATCH_QUEUE_SERIAL), ^{
        NSDictionary *prepare = [PKInProcess.shared prepare];
        if (delay > 0) [NSThread sleepForTimeInterval:delay];
        NSMutableDictionary *out = [([mode isEqualToString:@"apps"] ? Apps([args stringForKey:@"fixture"] ?: @"local.pokimcp.fixture") : Run(mode, tag, text)) mutableCopy];
        out[@"prepare"] = prepare;
        Write([tag stringByAppendingString:@".json"], out);
    });
    return YES;
}
@end

int main(int argc, char *argv[]) {
    @autoreleasepool { return UIApplicationMain(argc, argv, nil, NSStringFromClass(AppDelegate.class)); }
}
