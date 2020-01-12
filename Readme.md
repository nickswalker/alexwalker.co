# alexwalker.co

A responsive portfolio site.

## Development

### Locally

For the front page, open a terminal and then drag in the root folder of the site from Finder. Press enter.

Now, run the following:

    python -m SimpleHTTPServer 8000

You can access the site from a browser at `localhost:8000`

### Via GitHub

The master branch is deployed to `alexwalker.co` on every push.
The develop branch is deployed to `testing.alexwalker.co` on every push.

The recommenced procedure for making changes is to use the web UI to 

1. create a `develop` branch. If one existed before, it may be out of date, so it's best to delete and create it for each round of testing.
2. Make changes on this branch. Preview them online.
3. When ready to deploy, create a pull request from `develop` to `master`.
4. Merge the pull request.
5. Delete the `develop` branch.