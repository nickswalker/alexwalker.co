# Liquid filter: returns the last-modified date of a file in the repo,
# formatted however the caller asks. Used by the homepage's "Gear List
# – Updated <month>" button.
#
# Resolution order:
#   0. Sidecar override file — if a file with the same base path but a
#      `.txt` extension exists, its first non-empty line is returned
#      VERBATIM (no strftime formatting). This is the override knob for
#      cases where the auto-detection can't be trusted; on GitHub Pages
#      shallow clones, both git log AND File.mtime can be wrong for
#      files that weren't changed in the most recent commit.
#   1. `git log -1 --format=%ct` for the file — the COMMIT time.
#   2. Filesystem mtime as a last resort (unreliable on shallow clones
#      because every file's mtime is set to the checkout instant).
#
# Usage in a Liquid template:
#
#   {{ "img/AlexWalker_fullgearlist.pdf" | file_mtime: "%B %Y" }}
#   → "May 2026"
#
# To pin the displayed date: drop a sidecar text file next to it:
#   img/AlexWalker_fullgearlist.txt   →  contents: "May 2026"
#
require 'shellwords'

module Jekyll
  module FileMtimeFilter
    def file_mtime(path, format = "%B %Y")
      site_source = @context.registers[:site].source
      rel = path.to_s.sub(%r{^/}, '')
      full = File.join(site_source, rel)
      return "" unless File.exist?(full)

      # 0) Sidecar override — same base name with .txt extension.
      sidecar = File.join(File.dirname(full),
                          File.basename(full, File.extname(full)) + ".txt")
      if File.exist?(sidecar)
        File.foreach(sidecar) do |line|
          stripped = line.strip
          return stripped unless stripped.empty?
        end
      end

      time = nil

      # 1) Git commit time
      begin
        ts = `cd #{Shellwords.escape(site_source)} && git log -1 --format=%ct -- #{Shellwords.escape(rel)} 2>/dev/null`.strip
        time = Time.at(ts.to_i) unless ts.empty? || ts == "0"
      rescue StandardError
        # fall through
      end

      # 2) Filesystem mtime as a fallback
      time ||= File.mtime(full)

      time.strftime(format)
    end
  end
end

Liquid::Template.register_filter(Jekyll::FileMtimeFilter)
