// Minimal static file server for the depsview web interface.
// Serves the entire repository root so that web/app.js can import
// from ../src/ using relative ES module paths.
//
// Run from the repository root:
//
//	go run server.go
//	go run server.go -port 9000
package main

import (
	"flag"
	"fmt"
	"log"
	"mime"
	"net/http"
	"os"
)

// newHandler returns an http.Handler that serves static files from dir.
// It explicitly registers the .js MIME type as "application/javascript" so
// that browsers accept ES module scripts regardless of the host OS's MIME
// database (some minimal Linux environments omit this mapping).
func newHandler(dir string) http.Handler {
	mime.AddExtensionType(".js", "application/javascript")
	return http.FileServer(http.Dir(dir))
}

// main parses the -port flag, starts the file server, and prints the URL.
func main() {
	port := flag.String("port", "8080", "TCP port to listen on")
	flag.Parse()

	handler := newHandler("./web")

	addr := ":" + *port
	fmt.Fprintf(os.Stdout, "Serving depsview at http://localhost%s\n", addr)
	log.Fatal(http.ListenAndServe(addr, handler))
}
