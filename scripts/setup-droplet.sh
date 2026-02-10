#!/bin/bash

# Exit on error
set -e

echo "Starting Droplet setup for EVZone Backend..."

# 1. Update system
sudo apt update && sudo apt upgrade -y

# 2. Install Docker
if ! [ -x "$(command -v docker)" ]; then
    echo "Installing Docker..."
    curl -fsSL https://get.docker.com -o get-docker.sh
    sudo sh get-docker.sh
    sudo usermod -aG docker $USER
    rm get-docker.sh
fi

# 3. Install Nginx
if ! [ -x "$(command -v nginx)" ]; then
    echo "Installing Nginx..."
    sudo apt install -y nginx
fi

# 4. Install Certbot (for SSL)
echo "Installing Certbot..."
sudo apt install -y certbot python3-certbot-nginx

# 5. Backup default Nginx config
sudo mv /etc/nginx/sites-available/default /etc/nginx/sites-available/default.bak || true

# 6. Recommendation
echo "--------------------------------------------------------"
echo "Setup complete!"
echo "Next steps:"
echo "1. Upload your code to /home/$USER/evzone-backend"
echo "2. Copy nginx.conf to /etc/nginx/sites-available/evzone-backend"
echo "3. Run: sudo ln -s /etc/nginx/sites-available/evzone-backend /etc/nginx/sites-enabled/"
echo "4. Run: sudo nginx -t && sudo systemctl restart nginx"
echo "5. Run: sudo certbot --nginx -d api.evzonecharging.com"
echo "6. Run: cd /home/$USER/evzone-backend"
echo "7. Run: chmod +x scripts/deploy-compose.sh"
echo "8. Run: ./scripts/deploy-compose.sh"
echo "--------------------------------------------------------"
