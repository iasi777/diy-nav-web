#!/bin/bash

# =============================================================================
# Docker 服务清理脚本
# 用途：停止容器、删除镜像，方便快速重新部署测试
# =============================================================================

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

REMOTE_DIR="/opt/diy-nav-web"

echo ""
echo -e "${YELLOW}╔════════════════════════════════════════╗${NC}"
echo -e "${YELLOW}║     Docker 服务清理脚本                   ║${NC}"
echo -e "${YELLOW}╚════════════════════════════════════════╝${NC}"
echo ""

# 检查是否在正确的目录
if [ ! -f "deploy/docker-compose.yml" ] && [ ! -f "docker-compose.yml" ]; then
    log_warn "未找到 docker-compose.yml，尝试切换到 $REMOTE_DIR"
    cd $REMOTE_DIR 2>/dev/null || {
        log_error "无法找到项目目录，请在项目根目录或 $REMOTE_DIR 执行此脚本"
        exit 1
    }
fi

# 停止并删除容器
log_info "停止并删除容器..."
if [ -f "deploy/docker-compose.yml" ]; then
    docker compose -f deploy/docker-compose.yml down 2>/dev/null || log_warn "容器可能已停止"
elif [ -f "docker-compose.yml" ]; then
    docker compose down 2>/dev/null || log_warn "容器可能已停止"
fi

# 删除相关镜像
log_info "删除项目镜像..."
docker images --format "{{.Repository}}:{{.Tag}} {{.ID}}" | grep -E "nav-web|nav-api" | awk '{print $2}' | xargs -r docker rmi -f 2>/dev/null || log_warn "镜像可能已删除"

# 清理悬空镜像
log_info "清理悬空镜像..."
docker image prune -f >/dev/null 2>&1 || true

# 显示清理结果
echo ""
log_info "✅ 清理完成！"
echo ""
log_info "当前 Docker 状态："
echo "----------------------------------------"
docker ps -a --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" | grep -E "NAMES|nav-" || echo "  无相关容器运行"
echo ""
docker images --format "table {{.Repository}}\t{{.Tag}}\t{{.Size}}" | grep -E "REPOSITORY|nav-" || echo "  无相关镜像"
echo "----------------------------------------"
echo ""
