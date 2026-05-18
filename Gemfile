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
   # gem "html-proofer"  # disabled locally - not needed for preview
end
