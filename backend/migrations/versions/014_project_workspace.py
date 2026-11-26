"""Keep working sheet and display preferences with the project."""
from alembic import op
import sqlalchemy as sa

revision = '014'
down_revision = '013'
branch_labels = None
depends_on = None


def upgrade():
    # No FK: pages already depend on projects; deleted pages are cleared by API.
    op.add_column('projects', sa.Column('last_worked_page_id', sa.Integer(), nullable=True))
    op.add_column('projects', sa.Column('view_settings', sa.JSON(), nullable=False, server_default=sa.text("'{}'")))


def downgrade():
    op.drop_column('projects', 'view_settings')
    op.drop_column('projects', 'last_worked_page_id')
