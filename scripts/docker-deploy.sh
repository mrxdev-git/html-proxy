#!/bin/bash

# Docker Deployment Script for Node HTML Receiver
# Usage: ./scripts/docker-deploy.sh [dev|prod|build|stop|logs|clean]

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Helper functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if Docker is installed and running
check_docker() {
    if ! command -v docker &> /dev/null; then
        log_error "Docker is not installed. Please install Docker first."
        exit 1
    fi
    
    if ! docker info &> /dev/null; then
        log_error "Docker is not running. Please start Docker first."
        exit 1
    fi
}

# Build Docker image
build_image() {
    log_info "Building Docker image..."
    docker build -t html-receiver:latest .
    log_success "Docker image built successfully"
}

# Start development environment
start_dev() {
    log_info "Starting development environment..."
    
    # Create .env.local if it doesn't exist
    if [ ! -f .env.local ]; then
        log_info "Creating .env.local from .env.docker template..."
        cp .env.docker .env.local
        log_warning "Please review and customize .env.local as needed"
    fi
    
    docker-compose -f docker-compose.dev.yml up -d
    log_success "Development environment started"
    log_info "Application available at: http://localhost:${PORT:-8080}"
    log_info "View logs with: ./scripts/docker-deploy.sh logs dev"
}

# Start production environment
start_prod() {
    log_info "Starting production environment..."
    
    # Create .env.local if it doesn't exist
    if [ ! -f .env.local ]; then
        log_info "Creating .env.local from .env.docker template..."
        cp .env.docker .env.local
        log_warning "Please review and customize .env.local for production"
    fi
    
    docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d
    log_success "Production environment started"
    log_info "Application available at: http://localhost:${PORT:-8080}"
    log_info "View logs with: ./scripts/docker-deploy.sh logs prod"
}

# Stop services
stop_services() {
    local env=${1:-"all"}
    
    if [ "$env" = "dev" ] || [ "$env" = "all" ]; then
        log_info "Stopping development environment..."
        docker-compose -f docker-compose.dev.yml down
    fi
    
    if [ "$env" = "prod" ] || [ "$env" = "all" ]; then
        log_info "Stopping production environment..."
        docker-compose -f docker-compose.yml -f docker-compose.prod.yml down
    fi
    
    log_success "Services stopped"
}

# Show logs
show_logs() {
    local env=${1:-"prod"}
    local follow=${2:-""}
    
    if [ "$env" = "dev" ]; then
        docker-compose -f docker-compose.dev.yml logs $follow
    else
        docker-compose -f docker-compose.yml logs $follow
    fi
}

# Clean up Docker resources
clean_docker() {
    log_warning "This will remove all stopped containers, unused networks, and dangling images"
    read -p "Are you sure? (y/N): " -n 1 -r
    echo
    
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        log_info "Cleaning up Docker resources..."
        docker system prune -f
        log_success "Docker cleanup completed"
    else
        log_info "Cleanup cancelled"
    fi
}

# Show status
show_status() {
    log_info "Docker containers status:"
    docker ps --filter "name=html-receiver" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
    
    echo
    log_info "Docker images:"
    docker images --filter "reference=html-receiver*" --format "table {{.Repository}}\t{{.Tag}}\t{{.Size}}\t{{.CreatedAt}}"
}

# Health check
health_check() {
    local port=${PORT:-8080}
    log_info "Performing health check on port $port..."
    
    if curl -f -s "http://localhost:$port/healthz" > /dev/null; then
        log_success "Health check passed - service is running"
        curl -s "http://localhost:$port/healthz" | jq '.' 2>/dev/null || curl -s "http://localhost:$port/healthz"
    else
        log_error "Health check failed - service may not be running or healthy"
        exit 1
    fi
}

# Show help
show_help() {
    echo "Docker Deployment Script for Node HTML Receiver"
    echo
    echo "Usage: $0 [COMMAND] [OPTIONS]"
    echo
    echo "Commands:"
    echo "  build           Build Docker image"
    echo "  dev             Start development environment"
    echo "  prod            Start production environment"
    echo "  stop [env]      Stop services (env: dev|prod|all, default: all)"
    echo "  logs [env] [-f] Show logs (env: dev|prod, default: prod, -f to follow)"
    echo "  status          Show container and image status"
    echo "  health          Perform health check"
    echo "  clean           Clean up Docker resources"
    echo "  help            Show this help message"
    echo
    echo "Examples:"
    echo "  $0 dev                    # Start development environment"
    echo "  $0 prod                   # Start production environment"
    echo "  $0 logs dev -f            # Follow development logs"
    echo "  $0 stop dev               # Stop development environment"
    echo "  $0 clean                  # Clean up Docker resources"
}

# Main script logic
main() {
    check_docker
    
    case "${1:-help}" in
        "build")
            build_image
            ;;
        "dev")
            start_dev
            ;;
        "prod")
            start_prod
            ;;
        "stop")
            stop_services "$2"
            ;;
        "logs")
            if [ "$3" = "-f" ]; then
                show_logs "$2" "-f"
            else
                show_logs "$2"
            fi
            ;;
        "status")
            show_status
            ;;
        "health")
            health_check
            ;;
        "clean")
            clean_docker
            ;;
        "help"|*)
            show_help
            ;;
    esac
}

# Run main function with all arguments
main "$@"
