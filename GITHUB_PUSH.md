# Publish the submission on GitHub

Create an empty repository named `entrydesk` in your GitHub account. Do not initialize it with a README, license or gitignore; those files already exist here. Replace `YOUR_USERNAME` below.

```sh
cd /Users/ayushgarg/Desktop/internAss/submission

git init
git add .
git commit -m "Build shipment document extraction and NetCHB entry review app"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/entrydesk.git
git push -u origin main
```

If Git asks for your identity, configure your own name and GitHub email, then retry the commit:

```sh
git config user.name "Your Name"
git config user.email "YOUR_GITHUB_EMAIL"
```

Authenticate with your existing GitHub credential manager or an appropriate personal access token when prompted; GitHub account passwords cannot authenticate Git pushes over HTTPS. For a private repository, grant the reviewers access. Submit the repository URL together with the sample XML, review report, approach PDF and chat transcript.
