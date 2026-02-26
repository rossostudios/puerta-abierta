resource "aws_lb" "main" {
  name               = local.names.alb
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = [aws_subnet.public_a.id, aws_subnet.public_b.id]

  tags = {
    Name = local.names.alb
  }
}

resource "aws_lb_target_group" "backend_live" {
  name        = local.names.backend_live_tg
  port        = var.backend_port
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = aws_vpc.main.id

  health_check {
    enabled             = true
    path                = "/v1/ready"
    protocol            = "HTTP"
    matcher             = "200"
    interval            = 15
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 2
  }
}

resource "aws_lb_target_group" "backend_ready" {
  name        = local.names.backend_ready_tg
  port        = var.backend_port
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = aws_vpc.main.id

  health_check {
    enabled             = true
    path                = "/v1/ready"
    protocol            = "HTTP"
    matcher             = "200"
    interval            = 15
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 2
  }
}

resource "aws_lb_target_group" "admin_web" {
  count       = var.enable_admin_alb_rule ? 1 : 0
  name        = local.names.admin_web_tg
  port        = var.admin_port
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = aws_vpc.main.id

  health_check {
    enabled             = true
    path                = "/login"
    protocol            = "HTTP"
    matcher             = "200-399"
    interval            = 15
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }
}

resource "aws_lb_target_group" "web" {
  count       = var.enable_web_alb_rule ? 1 : 0
  name        = local.names.web_tg
  port        = var.web_port
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = aws_vpc.main.id

  health_check {
    enabled             = true
    path                = "/"
    protocol            = "HTTP"
    matcher             = "200-399"
    interval            = 15
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.main.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = "redirect"

    redirect {
      port        = "443"
      protocol    = "HTTPS"
      status_code = "HTTP_301"
    }
  }
}

resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.main.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = var.alb_certificate_arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.backend_live.arn
  }
}

resource "aws_lb_listener_certificate" "admin_https" {
  count = var.enable_admin_alb_rule && var.admin_alb_certificate_arn != null ? 1 : 0

  listener_arn    = aws_lb_listener.https.arn
  certificate_arn = var.admin_alb_certificate_arn
}

resource "aws_lb_listener_certificate" "web_https" {
  count = var.enable_web_alb_rule && var.web_alb_certificate_arn != null ? 1 : 0

  listener_arn    = aws_lb_listener.https.arn
  certificate_arn = var.web_alb_certificate_arn
}

resource "aws_lb_listener_rule" "admin_host" {
  count        = var.enable_admin_alb_rule ? 1 : 0
  listener_arn = aws_lb_listener.https.arn
  priority     = var.admin_rule_priority

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.admin_web[0].arn
  }

  condition {
    host_header {
      values = var.admin_hostnames
    }
  }
}

resource "aws_lb_listener_rule" "web_host" {
  count        = var.enable_web_alb_rule ? 1 : 0
  listener_arn = aws_lb_listener.https.arn
  priority     = var.web_rule_priority

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.web[0].arn
  }

  condition {
    host_header {
      values = var.web_hostnames
    }
  }
}
