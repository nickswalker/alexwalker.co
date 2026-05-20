# Liquid filter: returns the last-modified date of a file in the repo,
# formatted however the caller asks. Used by the homepage's "Gear List
# – Updated <month>" button so the date label refreshes automatically
# whenever a new gear-list PDF lands in img/, without anyone editing
# the HTML by hand.
#
# Resolution order:
#   1. `git log -1 --format=%ct` for the file — this is the COMMIT
#      time, which is preserved across the GitHub Actions checkout
#      (filesystem mtime gets reset to the checkout instant in CI,
#      so File.mtime would always return "today" there).
#   2. PDF /CreationDate metadata, if the file ends in .pdf and the
#      pdf-reader gem is loaded. (Optional fallback, not required.)
#   3. Filesystem mtime as a last resort.
#
# Usage in a Liquid template:
#
#   {{ "img/AlexWalker_fullgearlist.pdf" | file_mtime: "%B %Y" }}
#   → "April 2026"
#
require 'shellwords'

module Jekyll
  module FileMtimeFilter
    def file_mtime(path, format = "%B %Y")
      site_source = @context.registers[:site].source
      rel = path.to_s.sub(%r{^/}, '')
      full = File.join(site_source, rel)
      return "" unless File.exist?(full)

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
