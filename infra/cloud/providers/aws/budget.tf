# An email when the month's AWS spend is forecast to cross the threshold, and
# another when it actually does. Anthropic's spend is not here: that one is
# capped by GLOBAL_EXTRACTIONS_PER_WEEK in the extractor.
#
# Only with budget_email set; an account that already has a budget from the
# console does not need a second one.
resource "aws_budgets_budget" "monthly" {
  count = var.budget_email == null ? 0 : 1

  name         = "diagnosticar-monthly"
  budget_type  = "COST"
  limit_amount = tostring(var.monthly_budget_usd)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 80
    threshold_type             = "PERCENTAGE"
    notification_type          = "FORECASTED"
    subscriber_email_addresses = [var.budget_email]
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.budget_email]
  }
}
