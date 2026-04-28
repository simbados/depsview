#!/bin/bash

# 1. Global npm security configuration
echo "ignore-scripts=true" >> ~/.npmrc
echo "fund=false" >> ~/.npmrc
echo "update-notifier=false" >> ~/.npmrc
echo "min-release-age=7" >> ~/.npmrc
chmod 600 ~/.npmrc

# 2. Global pnpm security configuration
mkdir -p ~/.config/pnpm
echo "minimum-release-age=10080" >> ~/.config/pnpm/rc
echo "trust-policy=no-downgrade" >> ~/.config/pnpm/rc
echo "block-exotic-subdeps=true" >> ~/.config/pnpm/rc
chmod 600 ~/.config/pnpm/rc

# Install latest node
. ${NVM_DIR}/nvm.sh && nvm install --lts

echo "Package manager hardening applied successfully."