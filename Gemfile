source "https://rubygems.org"
ruby File.read(".ruby-version").strip

gem "jekyll", "~> 4.2"
# gem "unicode"  # disabled locally - won't compile on Ruby 3.3
group :jekyll_plugins do
   gem "jekyll-sitemap"
   # jekyll-tidy disabled — runs htmlbeautifier on every rendered page
   # and crashes ("Unmatched sequence") on the homepage's IG-row markup.
   # Plugin is purely cosmetic (HTML pretty-printing); removing has no
   # functional effect.
   # gem "jekyll-tidy"
end

# HTMLProofer is used by the CI workflow's `run tests` step to lint the
# built _site for broken links / bad anchors. Not needed for local preview
# but required by CI — keeping it outside the :jekyll_plugins group so it
# doesn't load during `jekyll build`.
group :test do
   gem "html-proofer"
end
