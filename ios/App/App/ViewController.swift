import UIKit
import Capacitor

// Capacitor's bridge with Safari's edge swipes: in from the left edge to go
// back, in from the right edge to go forward. The web app's game and team
// pages are history entries (pushState), so the swipes walk them with live
// snapshots of the page underneath, just like Safari.
class ViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        webView?.allowsBackForwardNavigationGestures = true
    }
}
