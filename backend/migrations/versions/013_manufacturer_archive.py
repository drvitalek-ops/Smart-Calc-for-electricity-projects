"""Keep manufacturer/product links when removing erroneous catalogue entries."""
from alembic import op
import sqlalchemy as sa
revision='013'
down_revision='012'
branch_labels=None
depends_on=None


def upgrade():
    op.add_column('manufacturers',sa.Column('active',sa.Boolean(),nullable=False,server_default=sa.true()))


def downgrade():
    op.drop_column('manufacturers','active')
